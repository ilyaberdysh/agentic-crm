// The configuration panel of the report editor (builder §2–§10): type switcher, data source, filter, the type's query
// section (metric, group by, segment by, status attribute, stages), Visualization and Target. Everything edits the
// local draft; nothing is saved until Save.
import {
  type AttributeDefinition,
  defaultGrouping,
  type FunnelSettings,
  type HistoricalSettings,
  type InsightSettings,
  type ReportAggregation,
  type ReportGrouping,
  type ReportMetric,
  type ReportType,
  type StageChangedSettings,
  type TimeInStageSettings,
  type VisualisationType,
} from '@agentic-crm/contracts';
import { Icon, IconButton, Menu, MenuItem, MenuTrigger, PopoverPanel, Tooltip } from '@agentic-crm/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog, Focusable } from 'react-aria-components';
import { attributeIcon, FilterBar } from '../../views';
import { PathPicker, PICKER_MAX_HEIGHT } from '../../views/components/PathPicker';
import { useAttributeOptions } from '../../views/data';
import { viewDrafts } from '../../views/draftStore';
import { addCondition, newCondition } from '../../views/filterModel';
import type { SchemaIndex } from '../../views/schemaIndex';
import type { ViewDraft } from '../../views/useViewDraft';
import { SourceIcon, useDataSources } from '../dataSources';
import {
  AGGREGATION_LABELS,
  COUNT_METRIC,
  DEFAULT_NUMERIC_AGGREGATION,
  isStageAttribute,
  METRIC_AGGREGATIONS,
  REPORT_TYPES,
  reportTypeMeta,
  TIME_IN_STAGE_AGGREGATIONS,
  VISUALISATION_META,
  type VisualisationOption,
  visualisationOptions,
} from '../reportModel';
import { ColorDots, GhostAdd, PopoverSelect, type StageOption, StageSelect, SwitchRow } from './controls';
import { type DraftAction, type DraftState } from './draft';
import * as e from './editor.css';
import { REPORT_PICKER_MAX_HEIGHT, ReportPathPicker } from './ReportPathPicker';

export interface ReportPanelProps {
  draft: DraftState;
  dispatch: (action: DraftAction) => void;
  schema: SchemaIndex | null;
  filterDraft: ViewDraft;
  readOnly: boolean;
  /** The data-source picker opens by itself for a new report without a source. */
  autoOpenSource: boolean;
  onChangeType: (type: ReportType) => void;
}

export function ReportPanel({
  draft,
  dispatch,
  schema,
  filterDraft,
  readOnly,
  autoOpenSource,
  onChangeType,
}: ReportPanelProps) {
  const type = draft.reportType as ReportType;
  const set = (patch: Record<string, unknown>) => dispatch({ type: 'settings', patch });
  const sourceId = draft.entityDefinitionId;
  return (
    <>
      <TypeSwitcher type={type} onChange={onChangeType} isDisabled={readOnly} />
      <div className={e.panelScroll} data-testid="report-panel">
        <div className={`${e.section} ${e.sourceSection}`}>
          <div className={e.field}>
            <span className={e.fieldLabel}>Data source</span>
            <DataSourceSelect
              value={sourceId}
              autoOpen={autoOpenSource}
              onChange={(id) => dispatch({ type: 'source', entityDefinitionId: id })}
              isDisabled={readOnly}
            />
          </div>
          {sourceId && <FilterSection draft={filterDraft} isDisabled={readOnly} />}
        </div>
        {sourceId && draft.settings && (
          <>
            <QuerySection
              type={type}
              settings={draft.settings as never}
              sourceId={sourceId}
              schema={schema}
              set={set}
              isDisabled={readOnly}
            />
            <VisualizationSection draft={draft} dispatch={dispatch} schema={schema} isDisabled={readOnly} />
          </>
        )}
      </div>
    </>
  );
}

// ---- type switcher -----------------------------------------------------------------------------------------------------

function TypeSwitcher({
  type,
  onChange,
  isDisabled,
}: {
  type: ReportType;
  onChange: (t: ReportType) => void;
  isDisabled: boolean;
}) {
  const meta = reportTypeMeta(type);
  const groups = [
    { title: 'Create your own', items: REPORT_TYPES.filter((t) => t.group === 'own') },
    { title: 'Pipeline reports', items: REPORT_TYPES.filter((t) => t.group === 'pipeline') },
  ];
  return (
    <div className={e.panelTypeRow}>
      <MenuTrigger>
        <AriaButton
          className={e.typeSwitcher}
          isDisabled={isDisabled}
          aria-label="Report type"
          data-testid="type-switcher"
        >
          <Icon icon={meta.icon} size={16} />
          {meta.title}
          <Icon icon="chevronDown" size={16} className={e.typeSwitcherChevron} />
        </AriaButton>
        <Menu
          aria-label="Report type"
          placement="bottom start"
          width={260}
          selectionMode="single"
          selectedKeys={[type]}
          onAction={(key) => onChange(key as ReportType)}
        >
          {groups.flatMap((g, gi) => [
            ...(gi > 0 ? [] : []),
            ...g.items.map((t) => (
              <MenuItem key={t.id} id={t.id} icon={t.icon} data-testid={`type-option-${t.id}`}>
                {t.title}
              </MenuItem>
            )),
          ])}
        </Menu>
      </MenuTrigger>
    </div>
  );
}

// ---- data source ---------------------------------------------------------------------------------------------------------

function DataSourceSelect({
  value,
  autoOpen,
  onChange,
  isDisabled,
}: {
  value: string | null;
  autoOpen: boolean;
  onChange: (id: string) => void;
  isDisabled: boolean;
}) {
  const { sources, byId, ready } = useDataSources();
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    // Opens by itself once for a new report without a source (builder §2.2).
    if (autoOpen && ready && !opened.current) {
      opened.current = true;
      setOpen(true);
    }
  }, [autoOpen, ready]);
  const current = value ? byId(value) : undefined;
  return (
    <PopoverSelect
      isOpen={open}
      onOpenChange={setOpen}
      leading={value ? <SourceIcon source={current} size={16} /> : undefined}
      label={value ? (current?.name ?? 'Inaccessible data source') : 'Choose a source...'}
      isPlaceholder={!value}
      isDisabled={isDisabled}
      aria-label="Data source"
      data-testid="data-source-select"
    >
      {(close) => (
        <SourceList
          sources={sources}
          onPick={(id) => {
            onChange(id);
            close();
          }}
          current={value}
        />
      )}
    </PopoverSelect>
  );
}

function SourceList({
  sources,
  onPick,
  current,
}: {
  sources: ReturnType<typeof useDataSources>['sources'];
  onPick: (id: string) => void;
  current: string | null;
}) {
  const [query, setQuery] = useState('');
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const objects = sources.filter((s) => s.kind === 'object' && match(s.name));
  const lists = sources.filter((s) => s.kind === 'list' && match(s.name));
  const row = (s: (typeof sources)[number]) => (
    <button
      key={s.id}
      type="button"
      className={e.stageRow}
      style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit', width: '100%' }}
      onClick={() => onPick(s.id)}
      data-testid="source-option"
      data-id={s.id}
      data-label={s.name}
    >
      <SourceIcon source={s} size={16} />
      <span className={e.stageName}>{s.name}</span>
      {s.id === current && <Icon icon="check" size={16} />}
    </button>
  );
  return (
    <div data-testid="data-source-popover">
      <div className={e.stageHeader}>
        <Icon icon="search" size={16} />
        <input
          className={e.stageSearch}
          placeholder="Search..."
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          aria-label="Search data sources"
          autoFocus
        />
      </div>
      <div className={e.stageList}>
        {objects.length === 0 && lists.length === 0 && <div style={{ padding: '6px 8px' }}>No data sources found</div>}
        {objects.length > 0 && <SectionTitle>Objects</SectionTitle>}
        {objects.map(row)}
        {lists.length > 0 && <SectionTitle>Lists</SectionTitle>}
        {lists.map(row)}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className={e.fieldLabel} style={{ padding: '6px 8px 2px' }}>
      {children}
    </div>
  );
}

// ---- filter ------------------------------------------------------------------------------------------------------------

function FilterSection({ draft, isDisabled }: { draft: ViewDraft; isDisabled: boolean }) {
  const model = draft.filterModel;
  const ref = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const empty = !model || model.children.length === 0;
  if (!empty)
    return (
      <div data-testid="report-filter">
        <FilterBar draft={draft} />
      </div>
    );
  return (
    <div data-testid="report-filter">
      <AriaButton
        ref={ref}
        className={e.ghostDashed}
        isDisabled={isDisabled || !model}
        onPress={() => setAdding(true)}
        data-testid="add-filter"
      >
        <Icon icon="filter" size={16} />
        Add filter
      </AriaButton>
      {adding && (
        <PopoverPanel
          triggerRef={ref}
          isOpen
          onOpenChange={(o) => !o && setAdding(false)}
          width={274}
          maxHeight={PICKER_MAX_HEIGHT}
        >
          <Dialog aria-label="Filter by attribute">
            <PathPicker
              rootDefinitionId={draft.view.entityDefinitionId}
              purpose="filter"
              placeholder="Search attributes..."
              onSelect={(sel) => {
                setAdding(false);
                if (!model) return;
                const cond = newCondition(sel.path, sel.field);
                draft.setFilterModel(addCondition(model, cond));
                viewDrafts.setFocus(draft.view.id, cond.id);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}

// ---- the type's query section ------------------------------------------------------------------------------------------------

interface QueryProps {
  type: ReportType;
  settings: Record<string, any>;
  sourceId: string;
  schema: SchemaIndex | null;
  set: (patch: Record<string, unknown>) => void;
  isDisabled: boolean;
}

function QuerySection(p: QueryProps) {
  switch (p.type) {
    case 'insights':
      return <InsightQuery {...p} />;
    case 'historical':
      return <HistoricalQuery {...p} />;
    case 'funnel':
      return <FunnelQuery {...p} />;
    case 'time-in-stage':
      return <TimeInStageQuery {...p} />;
    case 'stage-changed':
      return <StageChangedQuery {...p} />;
  }
}

function InsightQuery({ settings, sourceId, schema, set, isDisabled }: QueryProps) {
  const s = settings as InsightSettings;
  return (
    <div className={`${e.section} ${e.sectionTight}`}>
      <div className={e.card}>
        <div className={e.cardRow}>
          <span className={e.fieldLabel}>Metric</span>
          <MetricSelect
            metric={s.primaryMetric}
            sourceId={sourceId}
            schema={schema}
            onChange={(m) => set({ primaryMetric: m })}
            isDisabled={isDisabled}
          />
        </div>
      </div>
      <GroupingCard
        label={{ set: 'Grouped by', add: 'Group by', clear: 'Clear primary group by' }}
        mode="group"
        grouping={s.primaryGrouping}
        sourceId={sourceId}
        schema={schema}
        isDisabled={isDisabled}
        onChange={(g) => set({ primaryGrouping: g, ...(g ? {} : { secondaryGrouping: null }) })}
      />
      {s.primaryGrouping && (
        <GroupingCard
          label={{ set: 'Segmented by', add: 'Segment by', clear: 'Clear segment by' }}
          mode="group"
          grouping={s.secondaryGrouping}
          sourceId={sourceId}
          schema={schema}
          isDisabled={isDisabled}
          onChange={(g) => set({ secondaryGrouping: g })}
        />
      )}
    </div>
  );
}

function HistoricalQuery({ settings, sourceId, schema, set, isDisabled }: QueryProps) {
  const s = settings as HistoricalSettings;
  return (
    <div className={`${e.section} ${e.sectionTight}`}>
      <div className={e.card}>
        <div className={e.cardRow}>
          <span className={e.fieldLabel}>Metric</span>
          <MetricSelect
            metric={s.primaryMetric}
            sourceId={sourceId}
            schema={schema}
            onChange={(m) => set({ primaryMetric: m })}
            isDisabled={isDisabled}
          />
        </div>
      </div>
      <GroupingCard
        label={{ set: 'Segmented by', add: 'Segment by', clear: 'Clear segment by' }}
        mode="segment"
        grouping={s.primaryGrouping}
        sourceId={sourceId}
        schema={schema}
        isDisabled={isDisabled}
        onChange={(g) => set({ primaryGrouping: g })}
        extra={
          <HistoricMode
            historic={s.primaryGroupingIsHistoric}
            onChange={(v) => set({ primaryGroupingIsHistoric: v })}
            isDisabled={isDisabled}
          />
        }
      />
    </div>
  );
}

function HistoricMode({
  historic,
  onChange,
  isDisabled,
}: {
  historic: boolean;
  onChange: (v: boolean) => void;
  isDisabled: boolean;
}) {
  return (
    <PopoverSelect
      label={historic ? 'Historical' : 'Current'}
      aria-label="Grouping mode"
      width={150}
      isDisabled={isDisabled}
      data-testid="historic-mode"
    >
      {(close) => (
        <div style={{ padding: 4, display: 'flex', flexDirection: 'column' }}>
          {[
            { id: true, label: 'Historical', hint: 'Group by the values as they were at the time' },
            { id: false, label: 'Current', hint: 'Group by current values' },
          ].map((o) => (
            <Tooltip key={String(o.id)} content={o.hint} placement="left">
              <button
                type="button"
                className={e.stageRow}
                style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' }}
                onClick={() => {
                  onChange(o.id);
                  close();
                }}
              >
                <span className={e.stageName}>{o.label}</span>
                {o.id === historic && <Icon icon="check" size={16} />}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </PopoverSelect>
  );
}

function StatusCard({
  title = 'Status attribute',
  path,
  sourceId,
  schema,
  onPath,
  isDisabled,
  children,
}: {
  title?: string;
  path: AttributeDefinition['id'] extends string ? import('@agentic-crm/contracts').Path | null : never;
  sourceId: string;
  schema: SchemaIndex | null;
  onPath: (path: import('@agentic-crm/contracts').Path) => void;
  isDisabled: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(path === null);
  const attr = path ? schema?.leaf(path) : undefined;
  return (
    <div className={e.card}>
      <div className={e.cardRow}>
        <span className={e.fieldLabel}>{title}</span>
        <PopoverSelect
          isOpen={open}
          onOpenChange={setOpen}
          icon={attr ? attributeIcon(attr) : undefined}
          label={attr ? (schema?.pathLabel(path as never, null) ?? attr.title) : 'Choose an attribute...'}
          isPlaceholder={!attr}
          width={274}
          isDisabled={isDisabled}
          aria-label={title}
          data-testid="status-attribute-select"
        >
          {(close) => (
            <ReportPathPicker
              rootDefinitionId={sourceId}
              mode="status"
              onSelect={(sel) => {
                onPath(sel.path);
                close();
              }}
            />
          )}
        </PopoverSelect>
      </div>
      {children}
    </div>
  );
}

/** Stage options (id, title, colour) of a status / select attribute. */
function useStageOptions(attr: AttributeDefinition | undefined): StageOption[] {
  const list = useAttributeOptions(attr);
  return useMemo(
    () =>
      (list ?? [])
        .filter((o) => !('isArchived' in o && o.isArchived))
        .map((o) => ({ id: o.id, label: o.title, color: (o as { color?: string | null }).color ?? null })),
    [list],
  );
}

function FunnelQuery({ settings, sourceId, schema, set, isDisabled }: QueryProps) {
  const s = settings as FunnelSettings;
  const attr = s.funnelAttributePath ? schema?.leaf(s.funnelAttributePath) : undefined;
  const options = useStageOptions(attr);
  const pathKey = s.funnelAttributePath?.map((h) => h.attributeDefinitionId).join('/') ?? '';
  const autoFor = useRef('');
  // Choosing a status attribute selects all its stages (builder §8: at least two are needed to draw a funnel).
  useEffect(() => {
    if (!pathKey || options.length === 0 || autoFor.current === pathKey) return;
    autoFor.current = pathKey;
    if (s.funnelSelectedPipelineStageIds.length === 0)
      set({ funnelSelectedPipelineStageIds: options.map((o) => o.id) });
  }, [pathKey, options, s.funnelSelectedPipelineStageIds.length, set]);
  return (
    <div className={`${e.section} ${e.sectionTight}`}>
      <StatusCard
        path={s.funnelAttributePath}
        sourceId={sourceId}
        schema={schema}
        isDisabled={isDisabled}
        onPath={(path) => set({ funnelAttributePath: path, funnelSelectedPipelineStageIds: [] })}
      >
        {attr && (
          <>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Included stages</span>
              <StageSelect
                options={options}
                value={s.funnelSelectedPipelineStageIds}
                explicit
                onChange={(v) => set({ funnelSelectedPipelineStageIds: v ?? [] })}
                allRecordsChecked={s.topOfFunnelVisible}
                onAllRecordsChange={(v) => set({ topOfFunnelVisible: v })}
                searchPlaceholder="Search Stages…"
                isDisabled={isDisabled}
                data-testid="included-stages"
              />
            </div>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Metric</span>
              <MetricSelect
                metric={s.metric ?? COUNT_METRIC}
                sourceId={sourceId}
                schema={schema}
                onChange={(m) => set({ metric: m.attributePath === null ? null : m })}
                isDisabled={isDisabled}
              />
            </div>
          </>
        )}
      </StatusCard>
    </div>
  );
}

function TimeInStageQuery({ settings, sourceId, schema, set, isDisabled }: QueryProps) {
  const s = settings as TimeInStageSettings;
  const attr = s.statusAttributePath ? schema?.leaf(s.statusAttributePath) : undefined;
  const options = useStageOptions(attr);
  return (
    <div className={`${e.section} ${e.sectionTight}`}>
      <StatusCard
        path={s.statusAttributePath}
        sourceId={sourceId}
        schema={schema}
        isDisabled={isDisabled}
        onPath={(path) => set({ statusAttributePath: path, selectedStageIds: null })}
      >
        {attr && (
          <>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Included stages</span>
              <StageSelect
                options={options}
                value={s.selectedStageIds}
                onChange={(v) => set({ selectedStageIds: v })}
                searchPlaceholder="Search Stages…"
                isDisabled={isDisabled}
                data-testid="included-stages"
              />
            </div>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Aggregation</span>
              <OptionSelect
                label={AGGREGATION_LABELS[s.aggregation]}
                options={TIME_IN_STAGE_AGGREGATIONS.map((a) => ({ id: a, label: AGGREGATION_LABELS[a] }))}
                value={s.aggregation}
                onChange={(a) => set({ aggregation: a })}
                isDisabled={isDisabled}
                testId="aggregation-select"
              />
            </div>
          </>
        )}
      </StatusCard>
      {attr && (
        <GroupingCard
          label={{ set: 'Grouped by', add: 'Group by', clear: 'Clear primary group by' }}
          mode="group"
          grouping={s.primaryGrouping}
          sourceId={sourceId}
          schema={schema}
          isDisabled={isDisabled}
          onChange={(g) => set({ primaryGrouping: g })}
        />
      )}
    </div>
  );
}

function StageChangedQuery({ settings, sourceId, schema, set, isDisabled }: QueryProps) {
  const s = settings as StageChangedSettings;
  const attr = s.statusAttributePath ? schema?.leaf(s.statusAttributePath) : undefined;
  const options = useStageOptions(attr);
  return (
    <div className={`${e.section} ${e.sectionTight}`}>
      <StatusCard
        path={s.statusAttributePath}
        sourceId={sourceId}
        schema={schema}
        isDisabled={isDisabled}
        onPath={(path) => set({ statusAttributePath: path, selectedStageIds: null })}
      >
        {attr && (
          <>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Included stages</span>
              <StageSelect
                options={options}
                value={s.selectedStageIds}
                onChange={(v) => set({ selectedStageIds: v })}
                searchPlaceholder="Search Stages…"
                isDisabled={isDisabled}
                data-testid="included-stages"
              />
            </div>
            <div className={e.cardRow}>
              <span className={e.fieldLabel}>Metric</span>
              <MetricSelect
                metric={s.primaryMetric}
                sourceId={sourceId}
                schema={schema}
                onChange={(m) => set({ primaryMetric: m })}
                isDisabled={isDisabled}
              />
            </div>
          </>
        )}
      </StatusCard>
    </div>
  );
}

// ---- metric ------------------------------------------------------------------------------------------------------------------

function OptionSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  isDisabled,
  className,
  width,
  testId,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  isDisabled?: boolean;
  className?: string;
  width?: number;
  testId?: string;
}) {
  return (
    <PopoverSelect
      label={label}
      isDisabled={isDisabled}
      className={className}
      width={width ?? 'trigger'}
      aria-label={label}
      data-testid={testId}
    >
      {(close) => (
        <div style={{ padding: 4, display: 'flex', flexDirection: 'column' }}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={e.stageRow}
              style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' }}
              onClick={() => {
                onChange(o.id);
                close();
              }}
              data-testid={`option-${o.id}`}
            >
              <span className={e.stageName}>{o.label}</span>
              {o.id === value && <Icon icon="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </PopoverSelect>
  );
}

function MetricSelect({
  metric,
  sourceId,
  schema,
  onChange,
  isDisabled,
}: {
  metric: ReportMetric;
  sourceId: string;
  schema: SchemaIndex | null;
  onChange: (metric: ReportMetric) => void;
  isDisabled: boolean;
}) {
  const attr = metric.attributePath ? schema?.leaf(metric.attributePath) : undefined;
  const isCount = metric.attributePath === null;
  const label = isCount
    ? 'Count Records'
    : (schema?.pathLabel(metric.attributePath ?? [], null) ?? attr?.title ?? 'Attribute');
  return (
    <div className={e.joined} data-testid="metric-select">
      <PopoverSelect
        className={isCount ? undefined : e.joinedLeft}
        icon={attr ? attributeIcon(attr) : undefined}
        label={label}
        width={274}
        isDisabled={isDisabled}
        aria-label="Metric"
        data-testid="metric-attribute"
      >
        {(close) => (
          <ReportPathPicker
            rootDefinitionId={sourceId}
            mode="metric"
            onSelectCount={() => {
              onChange(COUNT_METRIC);
              close();
            }}
            onSelect={(sel) => {
              const keep: ReportAggregation =
                metric.attributePath === null ? DEFAULT_NUMERIC_AGGREGATION : metric.aggregation;
              onChange({ attributePath: sel.path, field: null, aggregation: keep });
              close();
            }}
          />
        )}
      </PopoverSelect>
      {!isCount && (
        <OptionSelect
          className={e.joinedRight}
          label={AGGREGATION_LABELS[metric.aggregation]}
          options={METRIC_AGGREGATIONS.map((a) => ({ id: a, label: AGGREGATION_LABELS[a] }))}
          value={metric.aggregation}
          onChange={(a) => onChange({ ...metric, aggregation: a })}
          isDisabled={isDisabled}
          width={170}
          testId="aggregation-select"
        />
      )}
    </div>
  );
}

// ---- grouping (group by / segment by) --------------------------------------------------------------------------------------------

function GroupingCard({
  label,
  mode,
  grouping,
  sourceId,
  schema,
  onChange,
  extra,
  isDisabled,
}: {
  label: { set: string; add: string; clear: string };
  mode: 'group' | 'segment';
  grouping: ReportGrouping | null;
  sourceId: string;
  schema: SchemaIndex | null;
  onChange: (grouping: ReportGrouping | null) => void;
  extra?: ReactNode;
  isDisabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const attr = grouping ? schema?.leaf(grouping.attributePath) : undefined;
  const options = useStageOptions(attr && (attr.type === 'pipeline' || attr.type === 'select') ? attr : undefined);
  const picker = (close: () => void) => (
    <ReportPathPicker
      rootDefinitionId={sourceId}
      mode={mode}
      onSelect={(sel) => {
        onChange(defaultGrouping(sel.path, sel.field));
        close();
      }}
    />
  );
  if (!grouping) {
    return (
      <PopoverSelectAsGhost
        label={label.add}
        isOpen={adding}
        onOpenChange={setAdding}
        isDisabled={isDisabled}
        testId={mode === 'group' && label.add === 'Group by' ? 'group-by-add' : 'segment-by-add'}
      >
        {picker}
      </PopoverSelectAsGhost>
    );
  }
  const stageLike = attr?.type === 'pipeline';
  const optionLike = attr?.type === 'select';
  return (
    <div className={e.card} data-testid={label.add === 'Group by' ? 'group-by-card' : 'segment-by-card'}>
      <div className={e.cardRow}>
        <div className={e.cardHeader}>
          <span className={e.fieldLabel}>{label.set}</span>
          <IconButton
            icon="close"
            aria-label={label.clear}
            size={20}
            onPress={() => onChange(null)}
            isDisabled={isDisabled}
            data-testid="clear-grouping"
          />
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PopoverSelect
              className={extra ? e.joinedLeft : undefined}
              icon={attr ? attributeIcon(attr) : undefined}
              label={
                attr
                  ? (schema?.pathLabel(grouping.attributePath, grouping.field, 'filter') ?? attr.title)
                  : 'Deleted attribute'
              }
              width={274}
              isDisabled={isDisabled}
              aria-label={label.set}
              data-testid="grouping-attribute"
            >
              {picker}
            </PopoverSelect>
          </div>
          {extra && <div style={{ width: 137, flex: 'none' }}>{extra}</div>}
        </div>
      </div>
      {stageLike && (
        <div className={e.cardRow}>
          <span className={e.fieldLabel}>Included stages</span>
          <StageSelect
            options={options}
            value={grouping.selectedPipelineStageIds.length ? grouping.selectedPipelineStageIds : null}
            onChange={(v) => onChange({ ...grouping, selectedPipelineStageIds: v ?? [] })}
            noneLabel="No stage"
            noneChecked={grouping.nullGroupVisible}
            onNoneChange={(v) => onChange({ ...grouping, nullGroupVisible: v })}
            searchPlaceholder="Search Stages…"
            isDisabled={isDisabled}
            data-testid="included-stages"
          />
        </div>
      )}
      {optionLike && (
        <div className={e.cardRow}>
          <span className={e.fieldLabel}>Included values</span>
          <StageSelect
            options={options}
            value={grouping.selectedValues}
            onChange={(v) => onChange({ ...grouping, selectedValues: v })}
            noneLabel={`No ${attr?.title ?? 'value'}`}
            noneChecked={grouping.nullGroupVisible}
            onNoneChange={(v) => onChange({ ...grouping, nullGroupVisible: v })}
            searchPlaceholder="Search Options…"
            isDisabled={isDisabled}
            data-testid="included-values"
          />
        </div>
      )}
      {!stageLike && !optionLike && (
        <div className={e.cardRowBare}>
          <SwitchRow
            compact
            label="Include empty values"
            isSelected={grouping.nullGroupVisible}
            onChange={(v) => onChange({ ...grouping, nullGroupVisible: v })}
            isDisabled={isDisabled}
            data-testid="include-empty-values"
          />
        </div>
      )}
    </div>
  );
}

/** A dashed ghost chip that opens a picker popover ("Group by", "Segment by"). */
function PopoverSelectAsGhost({
  label,
  isOpen,
  onOpenChange,
  isDisabled,
  testId,
  children,
}: {
  label: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isDisabled: boolean;
  testId: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <AriaButton
        ref={ref}
        className={e.ghostDashed}
        isDisabled={isDisabled}
        onPress={() => onOpenChange(true)}
        data-testid={testId}
      >
        <Icon icon="viewGrid" size={16} />
        {label}
      </AriaButton>
      {isOpen && (
        <PopoverPanel
          triggerRef={ref}
          isOpen
          onOpenChange={onOpenChange}
          width={274}
          maxHeight={REPORT_PICKER_MAX_HEIGHT}
          padding={0}
        >
          <Dialog aria-label={label}>{children(() => onOpenChange(false))}</Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

// ---- visualization -----------------------------------------------------------------------------------------------------------------

function VisualizationSection({
  draft,
  dispatch,
  schema,
  isDisabled,
}: {
  draft: DraftState;
  dispatch: (a: DraftAction) => void;
  schema: SchemaIndex | null;
  isDisabled: boolean;
}) {
  const type = draft.reportType as ReportType;
  const settings = draft.settings as unknown as Record<string, any>;
  const set = (patch: Record<string, unknown>) => dispatch({ type: 'settings', patch });
  const leaf = (path: import('@agentic-crm/contracts').Path) => schema?.leaf(path);
  const options = visualisationOptions(type, draft.settings as never, leaf);
  const visualisation = draft.visualisationType;
  const grouping = (settings.primaryGrouping ?? null) as ReportGrouping | null;
  const secondary = (settings.secondaryGrouping ?? null) as ReportGrouping | null;

  // Which options apply to the current configuration (builder §3.4 "Options under the select").
  const barLine = visualisation === 'bar' || visualisation === 'line';
  const showAxis = barLine && type !== 'funnel';
  const showZeros = type === 'insights' && barLine;
  const showStack =
    visualisation === 'bar' &&
    ((type === 'insights' && Boolean(secondary)) ||
      (type === 'historical' && Boolean(grouping)) ||
      (type === 'time-in-stage' && Boolean(grouping)) ||
      type === 'stage-changed');
  const groupAttr = grouping ? schema?.leaf(grouping.attributePath) : undefined;
  const chronological = groupAttr?.type === 'date' || groupAttr?.type === 'timestamp';
  const showSort =
    visualisation === 'bar' &&
    ((type === 'insights' && Boolean(grouping) && !chronological) || type === 'time-in-stage');
  const showTarget = barLine && type !== 'funnel';
  const hasSelect = type !== 'time-in-stage';

  if (type === 'time-in-stage' || options.length > 0) {
    // fallthrough: rendered below
  }
  return (
    <>
      <div className={`${e.section} ${e.sectionRows}`} data-testid="visualization-section">
        <span className={e.sectionHeading}>Visualization</span>
        {hasSelect && visualisation && (
          <VisualisationSelect
            options={options}
            value={visualisation}
            onChange={(v) => dispatch({ type: 'visualisation', value: v })}
            isDisabled={isDisabled}
          />
        )}
        <div className={e.switchStack}>
          {showAxis && (
            <SwitchRow
              label="Show axis labels"
              isSelected={Boolean(settings.axisLabelVisible)}
              onChange={(v) => set({ axisLabelVisible: v })}
              isDisabled={isDisabled}
              data-testid="show-axis-labels"
            />
          )}
          {showZeros && (
            <SwitchRow
              label="Show zeros"
              isSelected={Boolean(settings.zerosVisible)}
              onChange={(v) => set({ zerosVisible: v })}
              isDisabled={isDisabled}
              data-testid="show-zeros"
            />
          )}
          {showStack && (
            <SwitchRow
              label="Stack bars"
              isSelected={Boolean(settings.barSegmentsStacked)}
              onChange={(v) => set({ barSegmentsStacked: v })}
              isDisabled={isDisabled}
              data-testid="stack-bars"
            />
          )}
        </div>
        {showSort && (
          <SortControl
            sort={(settings.sortPreference ?? 'default_asc') as string}
            natural={
              type === 'time-in-stage' || groupAttr?.type === 'pipeline'
                ? 'Stage order'
                : groupAttr?.type === 'select'
                  ? 'Select option order'
                  : 'Alphabetical'
            }
            onChange={(v) => set({ sortPreference: v })}
            isDisabled={isDisabled}
          />
        )}
      </div>
      {showTarget && (
        <TargetSection
          value={(settings.targetValue ?? null) as number | null}
          onChange={(v) => set({ targetValue: v })}
          isDisabled={isDisabled}
        />
      )}
    </>
  );
}

function VisualisationSelect({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options: VisualisationOption[];
  value: VisualisationType;
  onChange: (v: VisualisationType) => void;
  isDisabled: boolean;
}) {
  const meta = VISUALISATION_META[value];
  const [query, setQuery] = useState('');
  const shown = options.filter((o) =>
    VISUALISATION_META[o.id].title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <PopoverSelect
      icon={meta.icon}
      label={meta.title}
      aria-label="Visualization"
      isDisabled={isDisabled}
      data-testid="visualisation-select"
    >
      {(close) => (
        <div data-testid="visualisation-popover">
          <div className={e.stageHeader}>
            <Icon icon="search" size={16} />
            <input
              className={e.stageSearch}
              placeholder="Search..."
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              aria-label="Search visualizations"
              autoFocus
            />
          </div>
          <div className={e.stageList}>
            {shown.map((o) => {
              const m = VISUALISATION_META[o.id];
              const row = (
                <button
                  key={o.id}
                  type="button"
                  className={e.stageRow}
                  aria-disabled={!o.enabled || undefined}
                  style={{
                    border: 0,
                    background: 'transparent',
                    textAlign: 'left',
                    color: o.enabled ? 'inherit' : undefined,
                    opacity: o.enabled ? 1 : 0.55,
                    cursor: o.enabled ? 'pointer' : 'default',
                    width: '100%',
                  }}
                  onClick={() => {
                    if (!o.enabled) return;
                    onChange(o.id);
                    close();
                  }}
                  data-testid={`visualisation-option-${o.id}`}
                  data-disabled={!o.enabled || undefined}
                >
                  <Icon icon={m.icon} size={16} />
                  <span className={e.stageName}>{m.title}</span>
                  {o.id === value && <Icon icon="check" size={16} />}
                </button>
              );
              return o.enabled || !o.reason ? (
                row
              ) : (
                <Tooltip key={o.id} content={o.reason} placement="left">
                  <Focusable>{row}</Focusable>
                </Tooltip>
              );
            })}
          </div>
          <div className={e.note}>
            <Icon icon="help" size={16} />
            <span>
              Available visualization types are restricted to align with your chosen attributes and reporting criteria.
            </span>
          </div>
        </div>
      )}
    </PopoverSelect>
  );
}

function SortControl({
  sort,
  natural,
  onChange,
  isDisabled,
}: {
  sort: string;
  natural: string;
  onChange: (v: string) => void;
  isDisabled: boolean;
}) {
  const byValue = sort.startsWith('value');
  const desc = sort.endsWith('desc');
  const compose = (v: boolean, d: boolean) => `${v ? 'value' : 'default'}_${d ? 'desc' : 'asc'}`;
  const lower = natural.toLowerCase();
  return (
    <PopoverSelectButton
      isDisabled={isDisabled}
      label={
        <>
          {byValue ? 'Sorted by ' : lower === 'alphabetical' ? 'Sorted ' : 'Sorted by '}
          <span className={e.sortStrong}>
            {byValue ? 'amount' : lower === 'alphabetical' ? 'alphabetically' : lower}
          </span>
        </>
      }
    >
      {(close) => (
        <div style={{ padding: 4, display: 'flex', flexDirection: 'column', width: 220 }} data-testid="sort-popover">
          {[
            { id: false, label: natural },
            { id: true, label: 'Amount' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              className={e.stageRow}
              style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' }}
              onClick={() => onChange(compose(o.id, desc))}
              data-testid={`sort-by-${o.id ? 'amount' : 'natural'}`}
            >
              <span className={e.stageName}>{o.label}</span>
              {o.id === byValue && <Icon icon="check" size={16} />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--ar-color-stroke-primary)', margin: '4px 0' }} />
          {[
            { id: false, label: 'Ascending' },
            { id: true, label: 'Descending' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              className={e.stageRow}
              style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' }}
              onClick={() => {
                onChange(compose(byValue, o.id));
                close();
              }}
              data-testid={`sort-${o.label.toLowerCase()}`}
            >
              <span className={e.stageName}>{o.label}</span>
              {o.id === desc && <Icon icon="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </PopoverSelectButton>
  );
}

/** A bordered chip button ("Sorted by stage order") that opens a popover. */
function PopoverSelectButton({
  label,
  isDisabled,
  children,
}: {
  label: ReactNode;
  isDisabled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <AriaButton
        ref={ref}
        className={e.sortButton}
        isDisabled={isDisabled}
        onPress={() => setOpen(true)}
        data-testid="sort-button"
      >
        <Icon icon="sortToggle" size={16} />
        <span>{label}</span>
      </AriaButton>
      {open && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={setOpen} padding={0}>
          <Dialog aria-label="Sort">{children(() => setOpen(false))}</Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

function TargetSection({
  value,
  onChange,
  isDisabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  isDisabled: boolean;
}) {
  const [on, setOn] = useState(value !== null);
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    if (value !== null) {
      setOn(true);
      setText((t) => (Number(t) === value ? t : String(value)));
    }
  }, [value]);
  return (
    <div className={`${e.section} ${e.sectionRows} ${e.targetSection}`} data-testid="target-section">
      <div className={e.switchRowSplit}>
        <span className={e.sectionHeading} style={{ marginBottom: 0 }}>
          Target
        </span>
        <SwitchRow
          label=""
          isSelected={on}
          onChange={(v) => {
            setOn(v);
            if (!v) {
              onChange(null);
              setText('');
            }
          }}
          isDisabled={isDisabled}
          data-testid="target-switch"
        />
      </div>
      {on && (
        <input
          className={e.targetInput}
          type="number"
          inputMode="decimal"
          placeholder="Add target"
          value={text}
          disabled={isDisabled}
          aria-label="Target"
          data-testid="target-input"
          onChange={(ev) => {
            setText(ev.target.value);
            const n = ev.target.value === '' ? null : Number(ev.target.value);
            onChange(n !== null && Number.isFinite(n) ? n : null);
          }}
        />
      )}
    </div>
  );
}

export { ColorDots, GhostAdd };
