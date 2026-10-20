// Step 3 — Review values (C2; evidence import-3-*): the Columns rail (file column over its attribute,
// orange dot when values need review), "Sorted by …", the per-type config (decimal separator, date / timestamp format)
// or "+ Create N missing select option(s)", and one row per distinct raw value grouped under "Needs review" and
// "Automatically mapped": raw text + row count → the mapped value drawn with the attribute's View, with skip / fix /
// revert. Edits apply to every row holding that raw value.
import type { AttributeDefinition, PathHop } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  Icon,
  type IconName,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Spinner,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { Navigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { getAttributeUi } from '../../attributes';
import { useWorkspace } from '../../shell/workspaceContext';
import { attributeIcon } from '../../views/operators';
import type { SchemaIndex } from '../../views/schemaIndex';
import {
  createMissingOptions,
  setMapping,
  setOverride,
  useImportsWorkspace,
  useReviewSummary,
  useReviewValues,
} from '../data/backend';
import type {
  DateFormat,
  DecimalSeparator,
  DistinctValue,
  ImportJob,
  MappingProperty,
  PropertyConfig,
} from '../data/contract';
import { mappingLabel } from '../model/mapping';
import { effectiveValues, needsReview } from '../model/resolve';
import { wizardPath } from './destination';
import type { WizardContext } from './ImportWizard';
import { useImportSchema } from './schema';
import { applyCommit, toRows, ValueView } from './values';
import * as s from './wizard.css';

type SortKey = 'raw-asc' | 'raw-desc' | 'count-asc' | 'count-desc';

const leafOf = (index: SchemaIndex | null, p: MappingProperty) =>
  index?.attribute(p.path[p.path.length - 1] as PathHop);

export function ReviewValuesStep({ ctx, job }: { ctx: WizardContext; job: ImportJob }) {
  const { href } = useWorkspace();
  const index = useImportSchema(job.entityDefinitionId);
  const properties = useMemo(() => [...job.mapping].sort((a, b) => a.columnIndex - b.columnIndex), [job.mapping]);
  const selected = properties.find((p) => p.id === ctx.location.param) ?? null;

  if (properties.length === 0)
    return (
      <Navigate to={href(wizardPath(ctx.base, { ...ctx.location, step: 'map-properties', param: null }))} replace />
    );
  if (!selected) {
    return (
      <Navigate
        to={href(wizardPath(ctx.base, { ...ctx.location, step: 'review-values', param: properties[0]?.id ?? null }))}
        replace
      />
    );
  }

  const footer = (
    <footer className={s.footer}>
      <span className={s.footerNote} />
      <Button variant="secondary" size={28} onPress={() => ctx.go({ step: 'map-properties', param: null })}>
        Back
      </Button>
      <Button
        size={28}
        isDisabled={job.status === 'ingesting'}
        onPress={() => ctx.go({ step: 'preview', param: null })}
      >
        Continue
      </Button>
    </footer>
  );

  if (job.status === 'ingesting') {
    return (
      <>
        <div className={s.centered} data-testid="waiting-upload">
          <Spinner size={16} />
          <div className={s.stateTitle}>Waiting for upload to complete</div>
          <div className={s.stateText}>
            We're still uploading your CSV file. You'll be able to progress in a few moments.
          </div>
        </div>
        {footer}
      </>
    );
  }

  return (
    <>
      <div className={s.reviewBody}>
        <div className={s.rail}>
          <div className={s.railTitle}>Columns</div>
          <div className={s.railList} data-testid="review-columns">
            {properties.map((p) => (
              <ColumnCard
                key={p.id}
                job={job}
                property={p}
                index={index}
                selected={p.id === selected.id}
                onSelect={() => ctx.go({ step: 'review-values', param: p.id }, true)}
              />
            ))}
          </div>
        </div>
        <ValuesPane key={selected.id} job={job} property={selected} attribute={leafOf(index, selected)} />
      </div>
      {footer}
    </>
  );
}

function ColumnCard({
  job,
  property,
  index,
  selected,
  onSelect,
}: {
  job: ImportJob;
  property: MappingProperty;
  index: SchemaIndex | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary = useReviewSummary(job.jobId);
  const attention = summary.data?.find((p) => p.propertyId === property.id)?.needsReview ?? false;
  const leaf = leafOf(index, property);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className={s.columnCard}
      data-selected={selected || undefined}
      data-testid="review-column"
      data-attention={attention || undefined}
      onClick={onSelect}
    >
      <span className={s.columnLine}>
        <span className={s.columnTile}>
          <Icon icon="csvFile" size={14} />
        </span>
        <span className={s.columnFile}>{job.columns[property.columnIndex]?.title}</span>
      </span>
      <span className={s.columnLine}>
        <span className={s.columnTile}>
          <Icon icon={leaf ? attributeIcon(leaf) : 'attrText'} size={14} />
        </span>
        <span className={s.columnAttr}>{mappingLabel(index, property.path, property.field)}</span>
      </span>
      {attention && <span className={s.reviewDot} aria-label="Needs review" />}
    </button>
  );
}

// ---- values pane -----------------------------------------------------------------------------------------------------

const SORTS: Array<{ id: SortKey; label: string; field: string; icon: IconName }> = [
  { id: 'raw-asc', label: 'Ascending', field: 'Raw value', icon: 'sortAscending' },
  { id: 'raw-desc', label: 'Descending', field: 'Raw value', icon: 'sortDescending' },
  { id: 'count-asc', label: 'Ascending', field: 'Row count', icon: 'sortAscending' },
  { id: 'count-desc', label: 'Descending', field: 'Row count', icon: 'sortDescending' },
];

function sortValues(values: DistinctValue[], key: SortKey): DistinctValue[] {
  const out = [...values];
  const byRaw = (a: DistinctValue, b: DistinctValue) => {
    if (!a.raw !== !b.raw) return a.raw ? 1 : -1; // "Empty" first
    return a.raw.localeCompare(b.raw, undefined, { numeric: true, sensitivity: 'base' });
  };
  if (key === 'raw-asc') out.sort(byRaw);
  if (key === 'raw-desc') out.sort((a, b) => byRaw(b, a));
  if (key === 'count-asc') out.sort((a, b) => a.rowCount - b.rowCount || byRaw(a, b));
  if (key === 'count-desc') out.sort((a, b) => b.rowCount - a.rowCount || byRaw(a, b));
  return out;
}

function ValuesPane({
  job,
  property,
  attribute,
}: {
  job: ImportJob;
  property: MappingProperty;
  attribute: AttributeDefinition | undefined;
}) {
  const review = useReviewValues(job.jobId, property.id);
  const [sort, setSort] = useState<SortKey>('raw-asc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const values = useMemo(() => sortValues(review.data?.values ?? [], sort), [review.data, sort]);
  const review1 = values.filter(needsReview);
  const auto = values.filter((v) => !needsReview(v));
  const sortDef = SORTS.find((x) => x.id === sort) as (typeof SORTS)[number];

  const toggle = (group: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <div className={s.reviewMain}>
      <div className={s.reviewToolbar}>
        <MenuTrigger>
          <Button variant="secondary" size={28} icon={sortDef.icon} data-testid="review-sort">
            <span className={s.buttonMuted}>Sorted by </span>
            <span className={s.buttonStrong}>{sortDef.field}</span>
          </Button>
          <Menu
            aria-label="Sort values"
            selectionMode="single"
            selectedKeys={[sort]}
            width={220}
            onAction={(k) => setSort(k as SortKey)}
          >
            <MenuSection title="Raw value">
              {SORTS.slice(0, 2).map((x) => (
                <MenuItem key={x.id} id={x.id} icon={x.icon}>
                  {x.label}
                </MenuItem>
              ))}
            </MenuSection>
            <MenuSection title="Row count">
              {SORTS.slice(2).map((x) => (
                <MenuItem key={x.id} id={x.id} icon={x.icon}>
                  {x.label}
                </MenuItem>
              ))}
            </MenuSection>
          </Menu>
        </MenuTrigger>
        {attribute && (
          <ConfigControl
            job={job}
            property={property}
            attribute={attribute}
            missing={review.data?.missingOptions ?? []}
          />
        )}
      </div>
      <div className={s.reviewHead}>
        <span>Raw data</span>
        <span />
        <span>Mapped value</span>
      </div>
      <div className={s.reviewScroll} data-testid="review-values">
        {!review.data || !attribute ? (
          <div className={s.centered}>
            <Spinner size={16} />
            <div className={s.stateText}>Loading values…</div>
          </div>
        ) : (
          <>
            {review1.length > 0 && (
              <Group
                title="Needs review"
                id="review"
                count={review1.length}
                collapsed={collapsed.has('review')}
                onToggle={() => toggle('review')}
              >
                {review1.map((v) => (
                  <ValueRow key={v.hash} job={job} property={property} attribute={attribute} value={v} />
                ))}
              </Group>
            )}
            {auto.length > 0 && (
              <Group
                title="Automatically mapped"
                id="auto"
                count={auto.length}
                collapsed={collapsed.has('auto')}
                onToggle={() => toggle('auto')}
              >
                {auto.map((v) => (
                  <ValueRow key={v.hash} job={job} property={property} attribute={attribute} value={v} />
                ))}
              </Group>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Group({
  title,
  id,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  id: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={`group-${id}`}>
      <button type="button" className={s.groupHead} aria-expanded={!collapsed} onClick={onToggle}>
        <Icon icon={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
        {title}
        <span className={s.groupCount}>{count}</span>
      </button>
      {!collapsed && children}
    </section>
  );
}

// ---- one distinct value ------------------------------------------------------------------------------------------------

function ValueRow({
  job,
  property,
  attribute,
  value,
}: {
  job: ImportJob;
  property: MappingProperty;
  attribute: AttributeDefinition;
  value: DistinctValue;
}) {
  const ws = useImportsWorkspace();
  const cell = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const values = effectiveValues(value);
  const invalid = needsReview(value);
  const errors = value.resolved.filter((p) => p.type === 'error');
  const missing = value.resolved.some((p) => p.type === 'missing-option');
  const skipped = values.length === 0 && (value.override !== null || value.resolved.length === 0);
  const write = (override: Parameters<typeof setOverride>[1]['override']) =>
    void setOverride(ws, {
      jobId: job.jobId,
      propertyId: property.id,
      hash: value.hash,
      raw: value.raw,
      override,
    }).catch(() => toast.error('Failed to update value'));
  const { Editor } = getAttributeUi(attribute.type);
  const rowLabel = `${value.rowCount} ${value.rowCount === 1 ? 'row' : 'rows'}`;

  const actions = value.override ? (
    <ActionButton icon="undo" label="Revert value" onPress={() => write(null)} />
  ) : skipped ? (
    <ActionButton icon="add" label="Add value" onPress={() => setEditing(true)} />
  ) : (
    <ActionButton icon="skip" label="Skip value" onPress={() => write({ skip: true })} />
  );

  let mapped: React.ReactNode;
  if (invalid && errors.length > 0 && !missing) {
    mapped = (
      <div className={s.invalidLine} ref={cell}>
        <span className={s.invalidPill} data-testid="invalid-pill">
          <Icon icon="warning" size={12} />
          {(errors[0] as { message: string }).message}
        </span>
        <span className={s.iconButtons}>
          <ActionButton plain icon="edit" label="Fix value" onPress={() => setEditing(true)} />
          <ActionButton plain icon="skip" label="Skip value" onPress={() => write({ skip: true })} />
        </span>
      </div>
    );
  } else {
    mapped = (
      <div className={s.mappedBox} ref={cell} data-testid="mapped-value">
        <div className={s.mappedMain} data-skipped={skipped || undefined}>
          {skipped ? (
            <>
              <Icon icon="skip" size={14} className={s.mappedIcon} />
              Skipped
            </>
          ) : (
            <>
              <Icon icon={attributeIcon(attribute)} size={14} className={s.mappedIcon} />
              {missing && !value.override ? (
                <span className={s.viewClip} style={{ gap: 4 }}>
                  {value.resolved.map((p, i) =>
                    p.type === 'missing-option' ? (
                      <Tooltip key={`m:${p.title}`} content="Value doesn't exist and will not be imported">
                        <span className={s.missingPill} tabIndex={0} data-testid="missing-option">
                          <Icon icon="warning" size={12} />
                          {p.title}
                        </span>
                      </Tooltip>
                    ) : p.type === 'value' ? (
                      <span key={i} className={s.viewClip} style={{ flex: 'none' }}>
                        <ValueView attribute={attribute} values={[p.value]} density="chip" />
                      </span>
                    ) : null,
                  )}
                </span>
              ) : (
                <span className={s.viewClip}>
                  <ValueView attribute={attribute} values={values} field={property.field} density="chip" />
                </span>
              )}
            </>
          )}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className={s.valueRow} data-testid="value-row" data-raw={value.raw}>
      <div className={s.rawCell}>
        <span className={s.rawText} data-empty={value.raw ? undefined : true}>
          {value.raw || 'Empty'}
        </span>
        <span className={s.rowCount}>{rowLabel}</span>
      </div>
      <span className={s.arrowCell}>
        <Icon icon="arrowRight" size={14} />
      </span>
      {mapped}
      {editing && (
        <Editor
          attribute={attribute}
          values={toRows(attribute, values)}
          anchor={cell.current}
          density="field"
          onCommit={(next, meta) => {
            const result = applyCommit(attribute, values, next);
            write(result.length > 0 ? { values: result } : { skip: true });
            if (!meta?.keepOpen) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  plain,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  plain?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={plain ? s.chipClear : s.mappedAction}
        style={plain ? { width: 24, height: 24 } : undefined}
        onClick={onPress}
      >
        <Icon icon={icon} size={14} />
      </button>
    </Tooltip>
  );
}

// ---- per-type configuration -------------------------------------------------------------------------------------------

const DECIMALS: Array<{ id: DecimalSeparator; label: string; example: string }> = [
  { id: 'point', label: 'Point', example: '1,000.00' },
  { id: 'comma', label: 'Comma', example: '1.000,00' },
];

const DATE_FORMATS: Array<{ id: DateFormat; label: string; example: string }> = [
  { id: 'iso', label: 'ISO standard', example: '2024-05-15' },
  { id: 'uk', label: 'European', example: '15-05-2024 • 15/05/2024 • 15 May 2024' },
  { id: 'us', label: 'American', example: '05-15-2024 • 05/15/2024 • May 15th 2024' },
];

function ConfigControl({
  job,
  property,
  attribute,
  missing,
}: {
  job: ImportJob;
  property: MappingProperty;
  attribute: AttributeDefinition;
  missing: string[];
}) {
  const ws = useImportsWorkspace();
  const update = (config: Partial<PropertyConfig>) =>
    void setMapping(ws, { jobId: job.jobId, configs: [{ propertyId: property.id, config }] }).catch(() =>
      toast.error('Failed to update the column'),
    );

  if (attribute.type === 'number' || attribute.type === 'currency') {
    const current = DECIMALS.find((d) => d.id === (property.config.decimalSeparator ?? 'point')) ?? DECIMALS[0];
    return (
      <MenuTrigger>
        <Button variant="secondary" size={28} icon="settings" data-testid="config-button">
          <span className={s.buttonMuted}>Decimal separator: </span>
          <span className={s.buttonStrong}>{current?.label}</span>
        </Button>
        <Menu
          aria-label="Decimal separator"
          selectionMode="single"
          selectedKeys={[current?.id ?? 'point']}
          placement="bottom end"
          width={240}
          onAction={(k) => update({ decimalSeparator: k as DecimalSeparator })}
        >
          {DECIMALS.map((d) => (
            <MenuItem key={d.id} id={d.id} description={d.example}>
              {d.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    );
  }
  if (attribute.type === 'date' || attribute.type === 'timestamp') {
    const key = attribute.type === 'date' ? 'dateFormat' : 'timestampFormat';
    const current = DATE_FORMATS.find((d) => d.id === (property.config[key] ?? 'iso')) ?? DATE_FORMATS[0];
    return (
      <MenuTrigger>
        <Button variant="secondary" size={28} icon="settings" data-testid="config-button">
          <span className={s.buttonMuted}>{attribute.type === 'date' ? 'Date format: ' : 'Timestamp format: '}</span>
          <span className={s.buttonStrong}>{current?.label}</span>
        </Button>
        <Menu
          aria-label={attribute.type === 'date' ? 'Date format' : 'Timestamp format'}
          selectionMode="single"
          selectedKeys={[current?.id ?? 'iso']}
          placement="bottom end"
          width={286}
          onAction={(k) => update({ [key]: k as DateFormat })}
        >
          {DATE_FORMATS.map((d) => (
            <MenuItem key={d.id} id={d.id} description={d.example}>
              {d.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    );
  }
  if ((attribute.type === 'select' || attribute.type === 'pipeline') && missing.length > 0)
    return <CreateOptions job={job} property={property} attribute={attribute} missing={missing} />;
  return null;
}

function CreateOptions({
  job,
  property,
  attribute,
  missing,
}: {
  job: ImportJob;
  property: MappingProperty;
  attribute: AttributeDefinition;
  missing: string[];
}) {
  const ws = useImportsWorkspace();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const status = attribute.type === 'pipeline';
  const n = missing.length;
  const noun = status ? (n === 1 ? 'status' : 'statuses') : n === 1 ? 'select option' : 'select options';
  return (
    <>
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom end"
        width={320}
        aria-label="Missing options"
        trigger={
          <Button variant="secondary" size={28} icon="add" data-testid="create-missing-options">
            {`Create ${n} missing ${noun}`}
          </Button>
        }
      >
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className={s.stateText} style={{ maxWidth: 'none' }}>
            {status
              ? "We couldn't match the following values to existing statuses in this attribute"
              : "We couldn't match the following values to existing select options in this attribute"}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {missing.map((m) => (
              <span key={m} className={s.optionPill}>
                {m}
              </span>
            ))}
          </div>
          <Button
            size={28}
            onPress={() => {
              setOpen(false);
              setConfirm(true);
            }}
          >
            {`Create missing ${status ? (n === 1 ? 'status' : 'statuses') : n === 1 ? 'select option' : 'select options'}`}
          </Button>
        </div>
      </Popover>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        variant="primary"
        title="Are you sure you want to modify this attribute?"
        description={`This will modify the attribute to include the missing ${n} ${noun}. This cannot be un-done.`}
        confirmLabel={
          status
            ? n === 1
              ? 'Create status'
              : 'Create statuses'
            : n === 1
              ? 'Create select option'
              : 'Create select options'
        }
        onConfirm={() =>
          void createMissingOptions(ws, { jobId: job.jobId, propertyId: property.id, values: missing }).catch(() =>
            toast.error(status ? 'Failed to create statuses' : 'Failed to create select options'),
          )
        }
      />
    </>
  );
}
