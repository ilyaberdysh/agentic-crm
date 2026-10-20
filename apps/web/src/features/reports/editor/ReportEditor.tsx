// The report editor / viewer frame (BACKLOG 9.03, 9.05, 9.08; H README §2.3, §2.4, §3.5, §3.8; builder §1, §5):
// an overlay over the main pane with the top bar (close, previous / next report, "n of m reports", presence, ⋮), the
// title row (inline title and description, Discard changes, Save ▾ As new report), the chart canvas (time toolbar,
// chart, calculated values) and the 416 px configuration panel. The draft is local until Save; Escape or ✕ with a
// dirty draft asks first. Read-only members get the chart without editing; J / K step through the dashboard's reports.
import {
  contributingDataFilter,
  type DashboardCell,
  type DatasetOutput,
  type Predicate,
  type Report,
  type ReportType,
  resolveReportWindow,
  type TimeResolution,
} from '@agentic-crm/contracts';
import { AlertDialog, AvatarGroup, Button, IconButton, Menu, MenuItem, MenuTrigger, toast } from '@agentic-crm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../../lib/ids';
import { useShortcut } from '../../../lib/shortcuts';
import { useWorkspace } from '../../shell/workspaceContext';
import { ShortcutTooltip } from '../../shortcuts/ShortcutHint';
import { CellMenu } from '../CellMenu';
import { buildChartContext, chartEnv } from '../chartContext';
import { CalculatedValuesBar, ChartMessage, type DrillTarget, downloadChartImage } from '../charts';
import {
  createReport,
  draftDatasetQuery,
  incompleteReason,
  refreshDataset,
  updateReport,
  useWs,
  viewerEnv,
} from '../data';
import { useDataSources } from '../dataSources';
import { ContributingDataModal, type ContributingTarget } from '../drilldown/ContributingDataModal';
import { InlineEdit } from '../InlineEdit';
import { NewDataPill } from '../NewDataPill';
import { DashboardPresenceContext } from '../presence';
import { ReportChartView } from '../ReportChartView';
import { isTimeGrouping, reportTypeMeta } from '../reportModel';
import { useStaleSeq } from '../staleStore';
import { useReportSchema } from '../useReportSchema';
import {
  type DraftAction,
  type DraftState,
  displayTitle,
  draftFromReport,
  emptyDraft,
  isDirty,
  queryDraft,
  reduceDraft,
  toServerDraft,
} from './draft';
import * as e from './editor.css';
import { useEphemeralDraft } from './ephemeralDraft';
import { ReportPanel } from './ReportPanel';
import { TimeToolbar } from './TimeToolbar';
import { TypePicker } from './TypePicker';

export interface ReportEditorProps {
  dashboardId: string;
  /** The dashboard's cells in order (neighbours for ▲ ▼ and J / K). */
  cells: (DashboardCell & { report: Report })[];
  /** The cell being edited; undefined = a new report. */
  cellId?: string;
  mode: 'new' | 'edit' | 'view';
  /** May update the dashboard. */
  canEdit: boolean;
}

const debounce = <T,>(value: T, ms: number): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

export function ReportEditor({ dashboardId, cells, cellId, mode, canEdit }: ReportEditorProps) {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const presence = useContext(DashboardPresenceContext);
  const { byId } = useDataSources();
  const entry = cellId ? cells.find((c) => c.id === cellId) : undefined;
  const saved = entry?.report ?? null;
  const isNew = !saved;
  const readOnly = !canEdit;

  // ---- draft ------------------------------------------------------------------------------------------------------------
  const [draft, setDraft] = useState<DraftState>(() => (saved ? draftFromReport(saved) : emptyDraft()));
  const schema = useReportSchema(draft.entityDefinitionId, draft.settings);
  const leafRef = useRef<
    (path: import('@agentic-crm/contracts').Path) => ReturnType<NonNullable<typeof schema>['leaf']>
  >(() => undefined);
  leafRef.current = (path) => schema?.leaf(path);
  const dispatch = useCallback(
    (action: DraftAction) => setDraft((prev) => reduceDraft(prev, action, (p) => leafRef.current(p))),
    [],
  );
  const dirty = isDirty(draft, saved);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // A saved report that changed elsewhere (or by our own Save) replaces a clean draft.
  const savedStamp = saved?.updatedAt;
  useEffect(() => {
    if (saved && !dirtyRef.current) setDraft(draftFromReport(saved));
    // Only a new saved version resets the draft.
  }, [savedStamp]);

  // ---- filter bar (an in-memory view draft) ------------------------------------------------------------------------------------
  const filterId = useMemo(() => `report-filter:${newId()}`, []);
  const filterDraft = useEphemeralDraft({
    id: filterId,
    title: 'Report filter',
    entityDefinitionId: draft.entityDefinitionId ?? '',
    userFilter: draft.filter,
    onUserFilterChange: (f) => dispatch({ type: 'filter', filter: f }),
  });

  // ---- dataset ------------------------------------------------------------------------------------------------------------------
  const env = useMemo(viewerEnv, []);
  const serverDraft = useMemo(() => toServerDraft(queryDraft(draft)), [draft]);
  const settledDraft = debounce(serverDraft, 250);
  const incomplete = useMemo(
    () =>
      draft.entityDefinitionId && draft.reportType && draft.settings
        ? incompleteReason({
            entityDefinitionId: draft.entityDefinitionId,
            filter: draft.filter,
            reportType: draft.reportType,
            visualisationType: draft.visualisationType,
            settings: draft.settings,
          })
        : null,
    [draft],
  );
  const datasetOptions = draftDatasetQuery(
    ws,
    (settledDraft ?? { entityDefinitionId: '', reportType: 'insights' }) as never,
    env,
    Boolean(settledDraft) && !incomplete,
  );
  const dataset = useQuery(datasetOptions);
  const staleSeq = useStaleSeq(ws.id, dataset.data?.freshness);

  const source = draft.entityDefinitionId ? byId(draft.entityDefinitionId) : undefined;
  const chartReport = useMemo(
    () =>
      draft.reportType && draft.settings && draft.visualisationType
        ? { reportType: draft.reportType, visualisationType: draft.visualisationType, settings: draft.settings }
        : null,
    [draft.reportType, draft.settings, draft.visualisationType],
  );
  const ctx = useMemo(
    () =>
      chartReport && schema
        ? buildChartContext({
            report: chartReport,
            schema,
            sourcePlural: source?.name ?? 'Records',
            env: chartEnv(env),
          })
        : null,
    [chartReport, schema, source?.name, env],
  );

  // ---- navigation ---------------------------------------------------------------------------------------------------------------
  const index = entry ? cells.findIndex((c) => c.id === entry.id) : -1;
  const prev = index > 0 ? cells[index - 1] : undefined;
  const next = index >= 0 && index < cells.length - 1 ? cells[index + 1] : undefined;
  const dashboardPath = href(`reports/dashboard/${dashboardId}`);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);
  const leave = (path: string) => {
    if (dirtyRef.current && !readOnly) setConfirmLeave(path);
    else void navigate({ href: path });
  };
  useShortcut('esc', () => leave(dashboardPath), { description: 'Close the report' });
  useShortcut('j', () => next && leave(href(`reports/dashboard/${dashboardId}/cell/${next.id}`)), {
    description: 'Next report',
  });
  useShortcut('k', () => prev && leave(href(`reports/dashboard/${dashboardId}/cell/${prev.id}`)), {
    description: 'Previous report',
  });

  // ---- saving -------------------------------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const canSave = Boolean(draft.entityDefinitionId && draft.reportType && draft.settings && draft.visualisationType);
  const params = () => ({
    entityDefinitionId: draft.entityDefinitionId as string,
    title: draft.title.trim() || 'New report',
    description: draft.description.trim() || null,
    filter: draft.filter,
    reportType: draft.reportType as ReportType,
    visualisationType: draft.visualisationType as NonNullable<DraftState['visualisationType']>,
    settings: draft.settings as NonNullable<DraftState['settings']>,
  });
  const save = async (asNew: boolean) => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (isNew || asNew) {
        const toastId = toast({ title: 'Creating new report...', durationMs: 2000 });
        void toastId;
        const { cell } = await createReport(ws, { dashboardId, ...params() });
        toast.success({ title: 'Your new report was created' });
        // The copy keeps the original untouched; the URL switches to the new cell's editor.
        void navigate({ href: href(`reports/dashboard/${dashboardId}/cell/${cell.id}/edit`), replace: !asNew });
      } else if (saved) {
        const next = await updateReport(ws, { reportId: saved.id, dashboardId, ...params() });
        setDraft(draftFromReport(next));
        toast.success({ title: 'Your report was saved' });
      }
    } catch (error) {
      toast.error({ title: 'Failed to save the report', description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => setDraft(saved ? draftFromReport(saved) : emptyDraft());

  // ---- type change --------------------------------------------------------------------------------------------------------------------
  const [pendingType, setPendingType] = useState<ReportType | null>(null);
  const changeType = (type: ReportType) => {
    if (type === draft.reportType) return;
    setPendingType(type);
  };

  // ---- canvas -----------------------------------------------------------------------------------------------------------------------------
  const [highlight, setHighlight] = useState<string | null>(null);
  const [contributing, setContributing] = useState<ContributingTarget | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const settings = draft.settings as unknown as Record<string, any> | null;
  const grouping = settings?.primaryGrouping ?? null;
  const groupAttr = grouping ? schema?.leaf(grouping.attributePath) : undefined;
  const timeToolbar =
    draft.reportType === 'historical' ||
    draft.reportType === 'stage-changed' ||
    (draft.reportType === 'insights' && grouping && isTimeGrouping(groupAttr, grouping.field));
  const windowEnv = useMemo(() => ({ today: chartEnv(env).today, weekStart: env.weekStart }), [env]);

  const columnsOf = () => {
    const out: ContributingTarget['columns'] = [];
    const s = settings;
    if (s?.primaryMetric?.attributePath) out.push({ path: s.primaryMetric.attributePath });
    if (s?.primaryGrouping) out.push({ path: s.primaryGrouping.attributePath });
    if (s?.secondaryGrouping) out.push({ path: s.secondaryGrouping.attributePath });
    return out;
  };
  const openContributing = (drill?: DrillTarget) => {
    if (!draft.entityDefinitionId || !settings) return;
    let filter: Predicate | null = draft.filter;
    let caption: string | undefined;
    if (drill && settings.primaryGrouping && groupAttr) {
      const time = {
        resolution: settings.timeConfig.resolution as TimeResolution,
        timeZone: env.timeZone,
        weekStart: env.weekStart,
      };
      filter = contributingDataFilter(
        filter,
        { path: settings.primaryGrouping.attributePath, field: settings.primaryGrouping.field },
        groupAttr.type,
        drill.group,
        time,
      );
      const seg = settings.secondaryGrouping;
      const segAttr = seg ? schema?.leaf(seg.attributePath) : undefined;
      if (seg && segAttr && drill.segment !== undefined && drill.segment !== null) {
        filter = contributingDataFilter(
          filter,
          { path: seg.attributePath, field: seg.field },
          segAttr.type,
          drill.segment,
          time,
        );
      }
    }
    setContributing({ entityDefinitionId: draft.entityDefinitionId, filter, columns: columnsOf(), caption });
  };

  const statusLabel = draft.reportType ? reportTypeMeta(draft.reportType).title : '';
  void statusLabel;
  const title = draft.title;
  const header = (
    <>
      <div className={e.topBar}>
        <div className={e.topBarGroup}>
          <IconButton
            icon="close"
            aria-label="Close"
            tooltip={<ShortcutTooltip description="Close" shortcut="esc" />}
            onPress={() => leave(dashboardPath)}
            data-testid="editor-close"
          />
          {entry && (
            <>
              <IconButton
                icon="chevronUp"
                aria-label="Previous report"
                tooltip={<ShortcutTooltip description="Previous report" shortcut="k" />}
                isDisabled={!prev}
                onPress={() => prev && leave(href(`reports/dashboard/${dashboardId}/cell/${prev.id}`))}
                data-testid="previous-report"
              />
              <IconButton
                icon="chevronDown"
                aria-label="Next report"
                tooltip={<ShortcutTooltip description="Next report" shortcut="j" />}
                isDisabled={!next}
                onPress={() => next && leave(href(`reports/dashboard/${dashboardId}/cell/${next.id}`))}
                data-testid="next-report"
              />
              <span className={e.counter} data-testid="report-counter">
                {index + 1} of {cells.length} {cells.length === 1 ? 'report' : 'reports'}
              </span>
            </>
          )}
        </div>
        <div className={e.topBarGroup}>
          {presence.length > 0 && (
            <AvatarGroup
              size={20}
              max={4}
              items={presence.map((u) => ({ id: u.userId, name: u.name, seed: u.userId, kind: 'member' as const }))}
            />
          )}
          {saved && entry && (
            <CellMenu
              dashboardId={dashboardId}
              cellId={entry.id}
              reportId={saved.id}
              createdBy={saved.createdBy}
              createdAt={saved.createdAt}
              canEdit={canEdit}
              withEdit={false}
              onDownload={() =>
                chartRef.current && void downloadChartImage(chartRef.current, `${saved.title || 'report'}.png`)
              }
              onDeleted={() => void navigate({ href: dashboardPath })}
            />
          )}
        </div>
      </div>
      <div className={e.titleRow}>
        <div className={e.titleGroup}>
          <InlineEdit
            variant="title"
            value={title}
            placeholder="Enter report title..."
            emptyLabel="Untitled Report"
            readOnly={readOnly}
            maxLength={256}
            data-testid="report-title"
            onCommit={(v) => dispatch({ type: 'title', value: v })}
          />
          <InlineEdit
            variant="description"
            value={draft.description}
            placeholder="Describe report..."
            readOnly={readOnly}
            maxLength={4000}
            data-testid="report-description"
            onCommit={(v) => dispatch({ type: 'description', value: v })}
          />
        </div>
        <div className={e.titleActions}>
          {staleSeq && (
            <NewDataPill
              accurateAt={dataset.data?.freshness.accurateAt}
              refreshing={dataset.isFetching}
              onRefresh={() => void refreshDataset(client, datasetOptions.queryKey, staleSeq)}
            />
          )}
          {!readOnly && draft.reportType && (isNew || dirty) && (
            <>
              <Button variant="ghost" size={28} onPress={discard} data-testid="discard-changes">
                Discard changes
              </Button>
              <span className={e.saveGroup}>
                <Button
                  variant="primary"
                  size={28}
                  isDisabled={!canSave || saving}
                  onPress={() => void save(false)}
                  data-testid="save-report"
                >
                  Save
                </Button>
                {!isNew && (
                  <MenuTrigger>
                    <IconButton
                      icon="chevronDown"
                      aria-label="More save options"
                      variant="primary"
                      size={28}
                      isDisabled={!canSave || saving}
                      data-testid="save-options"
                    />
                    <Menu aria-label="Save options" placement="bottom end" width={180} onAction={() => void save(true)}>
                      <MenuItem id="new">As new report</MenuItem>
                    </Menu>
                  </MenuTrigger>
                )}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  );

  // The dataset belongs to the settled (debounced) draft: until it catches up with the edit the old rows must not be
  // drawn with the new configuration.
  const inSync = JSON.stringify(serverDraft) === JSON.stringify(settledDraft);
  const data = inSync ? (dataset.data as DatasetOutput | undefined) : undefined;
  return (
    <div
      className={e.overlay}
      role="dialog"
      aria-label={displayTitle(title)}
      data-allow-global-shortcuts
      data-testid="report-editor"
      data-mode={mode}
    >
      {header}
      <div className={e.body}>
        <div className={e.canvas} data-testid="editor-canvas">
          <div className={e.canvasBody}>
            {timeToolbar && settings?.timeConfig && (
              <TimeToolbar
                config={settings.timeConfig}
                env={windowEnv}
                visualisation={draft.visualisationType}
                isDisabled={readOnly}
                onChange={(timeConfig) => dispatch({ type: 'settings', patch: { timeConfig } })}
              />
            )}
            <div className={e.canvasChart} ref={chartRef} data-testid="canvas-chart">
              {!draft.reportType || !draft.entityDefinitionId || !chartReport ? (
                <ChartMessage title="Input needed to display chart" subtitle="Select a data source" />
              ) : (
                <ReportChartView
                  report={chartReport}
                  schema={schema}
                  source={source}
                  size="canvas"
                  state={{
                    data,
                    isPending: dataset.isPending || !inSync,
                    error: inSync ? dataset.error : null,
                    incomplete,
                  }}
                  highlightKey={highlight}
                  onHighlight={setHighlight}
                  onDrill={draft.reportType === 'insights' ? (t) => openContributing(t) : undefined}
                />
              )}
            </div>
          </div>
          {ctx && data && (
            <CalculatedValuesBar
              ctx={ctx}
              data={data}
              highlightKey={highlight}
              onHighlight={setHighlight}
              onViewContributingData={draft.reportType === 'insights' ? () => openContributing() : undefined}
              csvFileName={`${displayTitle(title)}.csv`}
            />
          )}
        </div>
        <aside className={e.panel} aria-label="Report configuration">
          {draft.reportType ? (
            <ReportPanel
              draft={draft}
              dispatch={dispatch}
              schema={schema}
              filterDraft={filterDraft}
              readOnly={readOnly}
              autoOpenSource={isNew && !draft.entityDefinitionId}
              onChangeType={changeType}
            />
          ) : (
            <TypePicker onPick={(type) => dispatch({ type: 'choose-type', reportType: type })} />
          )}
        </aside>
      </div>
      <AlertDialog
        isOpen={confirmLeave !== null}
        onOpenChange={(o) => !o && setConfirmLeave(null)}
        title="Are you sure you want to cancel?"
        description="You will lose any unsaved progress"
        onConfirm={() => confirmLeave && void navigate({ href: confirmLeave })}
      />
      <AlertDialog
        isOpen={pendingType !== null}
        onOpenChange={(o) => !o && setPendingType(null)}
        title="Are you sure you want to change the report type?"
        description="This may overwrite your current configuration"
        onConfirm={() => pendingType && dispatch({ type: 'choose-type', reportType: pendingType })}
      />
      {contributing && <ContributingDataModal target={contributing} onClose={() => setContributing(null)} />}
    </div>
  );
}

void resolveReportWindow;
