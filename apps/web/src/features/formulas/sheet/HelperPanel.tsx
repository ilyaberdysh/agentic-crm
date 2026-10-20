// Helper panel body (formulas.md §4.3): searchable list (Attributes with drill-in and Show more / Show less,
// Functions `name()`) on the left; detail of the active row on the right — the intro when nothing is active, a
// function's signature, description and examples, an attribute's description, return type and examples. Examples are
// clickable ("Examples • Click to add to formula"). Mouse hover sets the active row.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { ATTRIBUTE_EXAMPLES, ATTRIBUTE_PLACEHOLDER, type Kind, kindLabel } from '@agentic-crm/formula';
import { Icon } from '@agentic-crm/ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import { type HelperGroup, type HelperItem, signature } from '../model/helper';
import { isFormulaKind } from '../model/schema';
import * as s from './sheet.css';

export interface HelperPanelProps {
  groups: HelperGroup[];
  activeKey: string | null;
  onActiveKey: (key: string | null) => void;
  search: string;
  /** The editor drives the query (the search box is disabled meanwhile). */
  searchDisabled: boolean;
  onSearch: (query: string) => void;
  onActivate: (item: HelperItem) => void;
  onDrill: (item: Extract<HelperItem, { kind: 'attribute' }>) => void;
  onExample: (code: string, item: HelperItem) => void;
  /** Child attribute count of a drillable row (target object's attributes). */
  childCount: (entityDefinitionId: string) => number | null;
}

export function HelperPanel(props: HelperPanelProps) {
  const { groups, activeKey } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const items = groups.flatMap((g) => g.items);
  const active = items.find((i) => i.key === activeKey) ?? null;

  useEffect(() => {
    if (!activeKey) return;
    const el = listRef.current?.querySelector(`[data-key="${CSS.escape(activeKey)}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  return (
    <div className={s.helperBody} data-testid="formula-helper">
      <div className={s.list}>
        <label className={s.search}>
          <Icon icon="search" size={16} />
          <input
            className={s.searchInput}
            placeholder="Search..."
            aria-label="Search functions and attributes"
            value={props.searchDisabled ? '' : props.search}
            disabled={props.searchDisabled}
            onChange={(e) => props.onSearch(e.target.value)}
          />
        </label>
        <div className={s.listScroll} ref={listRef} role="listbox" aria-label="Formula helper">
          {groups.map((group) => (
            <div key={group.id} role="group" aria-label={group.label}>
              <div className={s.groupLabel}>{group.label}</div>
              {group.items.map((item) => (
                <HelperRow
                  key={item.key}
                  item={item}
                  active={item.key === activeKey}
                  onHover={() => props.onActiveKey(item.key)}
                  onActivate={() => props.onActivate(item)}
                  onDrill={item.kind === 'attribute' && item.drillTarget ? () => props.onDrill(item) : undefined}
                  childCount={item.kind === 'attribute' && item.drillTarget ? props.childCount(item.drillTarget) : null}
                />
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className={s.groupLabel}>No results</div>}
        </div>
      </div>
      <div className={s.detail} data-testid="formula-helper-detail">
        <Detail item={active} onExample={(code) => active && props.onExample(code, active)} />
      </div>
    </div>
  );
}

function HelperRow({
  item,
  active,
  onHover,
  onActivate,
  onDrill,
  childCount,
}: {
  item: HelperItem;
  active: boolean;
  onHover: () => void;
  onActivate: () => void;
  onDrill?: () => void;
  childCount: number | null;
}) {
  let icon: ReactNode = null;
  let label: ReactNode = null;
  if (item.kind === 'back') {
    icon = <Icon icon="chevronLeft" size={16} className={s.rowIcon} />;
    label = item.label;
  } else if (item.kind === 'toggle') {
    icon = <Icon icon={item.expanded ? 'chevronUp' : 'chevronDown'} size={16} className={s.rowIcon} />;
    label = item.expanded ? 'Show less' : 'Show more';
  } else if (item.kind === 'function') {
    const isOperator = item.decl.help?.kind === 'operator';
    icon = <Icon icon={isOperator ? 'attrCheckbox' : 'formulaFx'} size={16} className={s.rowIcon} />;
    label = <span className={s.rowMono}>{item.decl.name}()</span>;
  } else {
    icon = <Icon icon={attributeIcon(item.attribute)} size={16} className={s.rowIcon} />;
    label = (
      <>
        {item.breadcrumb.slice(0, -1).map((c) => (
          <span key={c} className={s.rowCrumb}>
            {c} ›{' '}
          </span>
        ))}
        {item.attribute.title}
      </>
    );
  }
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={active}
      className={s.row}
      data-active={active || undefined}
      data-key={item.key}
      data-testid="formula-helper-row"
      onPointerEnter={onHover}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onActivate}
      onKeyDown={undefined}
    >
      {icon}
      <span className={s.rowLabel}>{label}</span>
      {onDrill ? (
        <button
          type="button"
          className={s.drill}
          aria-label={`Show attributes of ${item.kind === 'attribute' ? item.attribute.title : ''}`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onDrill();
          }}
        >
          {childCount !== null && <span className={s.rowTrailing}>{childCount}</span>}
          <Icon icon="chevronRight" size={14} />
        </button>
      ) : active && (item.kind === 'attribute' || item.kind === 'function') ? (
        <span className={s.rowTrailing}>
          <Icon icon="enter" size={14} />
        </span>
      ) : null}
    </div>
  );
}

function returnsLabel(attribute: AttributeDefinition, multi: boolean): string {
  const base = isFormulaKind(attribute.type) ? kindLabel(attribute.type) : attribute.type;
  return multi ? `${base}[]` : base;
}

function Detail({ item, onExample }: { item: HelperItem | null; onExample: (code: string) => void }) {
  if (!item || item.kind === 'back' || item.kind === 'toggle') {
    return (
      <div className={s.detailEmpty}>
        <div className={s.detailEmptyTitle}>Formula attributes</div>
        <div className={s.detailEmptyText}>
          Perform a wide range of calculations and functions based on your attributes and data.
        </div>
      </div>
    );
  }
  if (item.kind === 'function') {
    const help = item.decl.help;
    return (
      <>
        <div className={s.detailSignature}>{signature(item.decl)}</div>
        {help && <div className={s.detailText}>{help.description}</div>}
        {help && help.examples.length > 0 && (
          <Examples
            examples={help.examples.map((e) => ({ code: e.code, output: e.output }))}
            attributeTitle={null}
            onExample={onExample}
          />
        )}
      </>
    );
  }
  const multi = item.attribute.isMultiselect || item.path.slice(0, -1).length > 0;
  const kind = item.attribute.type as Kind;
  const sets = isFormulaKind(kind) ? ATTRIBUTE_EXAMPLES[kind] : null;
  const codes = sets ? (multi ? sets.arrayExamples : sets.examples) : [];
  const description = item.attribute.description.trim();
  return (
    <>
      <div className={s.detailTitle}>
        <Icon icon={attributeIcon(item.attribute)} size={16} className={s.rowIcon} />
        {item.breadcrumb.join(' › ')}
      </div>
      <div className={s.detailText}>
        {description ? `${description.replace(/\.$/, '')}. ` : ''}Returns {returnsLabel(item.attribute, multi)}.
      </div>
      {codes.length > 0 && (
        <Examples
          examples={codes.map((code) => ({ code, output: null }))}
          attributeTitle={item.breadcrumb.join(' › ')}
          onExample={onExample}
        />
      )}
    </>
  );
}

function Examples({
  examples,
  attributeTitle,
  onExample,
}: {
  examples: { code: string; output: string | null }[];
  attributeTitle: string | null;
  onExample: (code: string) => void;
}) {
  return (
    <>
      <div className={s.examplesLabel}>
        Examples <span className={s.examplesHint}>• Click to add to formula</span>
      </div>
      <div className={s.examples}>
        {examples.map((e) => (
          <button
            key={e.code}
            type="button"
            className={s.example}
            data-testid="formula-example"
            onPointerDown={(ev) => ev.preventDefault()}
            onClick={() => onExample(e.code)}
          >
            <span className={s.exampleCode}>
              <StaticCode code={e.code} attributeTitle={attributeTitle} />
            </span>
            {e.output !== null && <span className={s.exampleOutput}>= {e.output}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

const TOKEN_RE =
  /(_\{attr\})|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\()|([^"_\dA-Za-z]+|.)/g;

/** Static highlighting of an example (same colours as the editor; `_{attr}` as a chip). */
export function StaticCode({ code, attributeTitle }: { code: string; attributeTitle: string | null }) {
  const out: ReactNode[] = [];
  let i = 0;
  for (const m of code.matchAll(TOKEN_RE)) {
    const key = i++;
    if (m[1] === ATTRIBUTE_PLACEHOLDER) {
      out.push(
        <span key={key} className="cm-formula-chip" data-state="default">
          <span className="cm-formula-chip-brace">{'{'}</span>
          {attributeTitle ?? 'attribute'}
          <span className="cm-formula-chip-brace">{'}'}</span>
        </span>,
      );
    } else if (m[2])
      out.push(
        <span key={key} style={{ color: 'var(--ar-color-utilities-content-cyan)' }}>
          {m[2]}
        </span>,
      );
    else if (m[3])
      out.push(
        <span key={key} style={{ color: 'var(--ar-color-utilities-content-green)' }}>
          {m[3]}
        </span>,
      );
    else if (m[4])
      out.push(
        <span key={key} style={{ color: 'var(--ar-color-utilities-content-blue)' }}>
          {m[4]}
        </span>,
      );
    else out.push(<span key={key}>{m[0]}</span>);
  }
  return <>{out}</>;
}
