// The editor's draft (builder §1, §5, §6): everything about a report that Save writes, kept locally until then. Pure
// reducer + helpers (unit-tested): choosing a type resets the settings to the type's defaults (keeping title,
// description, source and filter); changing the data source clears the filter and the settings; every settings change
// re-normalises the visualisation (first allowed when the current one became invalid).
import {
  DEFAULT_REPORT_TITLE,
  defaultReportSettings,
  type Predicate,
  type Report,
  type ReportDraft,
  type ReportSettings,
  type ReportType,
  type VisualisationType,
} from '@agentic-crm/contracts';
import { type LeafResolver, normaliseVisualisationChoice } from '../reportModel';

export interface DraftState {
  title: string;
  description: string;
  entityDefinitionId: string | null;
  filter: Predicate | null;
  /** null = the type picker is still showing (new report). */
  reportType: ReportType | null;
  visualisationType: VisualisationType | null;
  settings: ReportSettings | null;
}

export function emptyDraft(): DraftState {
  return {
    title: DEFAULT_REPORT_TITLE,
    description: '',
    entityDefinitionId: null,
    filter: null,
    reportType: null,
    visualisationType: null,
    settings: null,
  };
}

export function draftFromReport(report: Report): DraftState {
  return {
    title: report.title,
    description: report.description ?? '',
    entityDefinitionId: report.entityDefinitionId,
    filter: report.filter,
    reportType: report.reportType,
    visualisationType: report.visualisationType,
    settings: structuredClone(report.settings),
  };
}

export type DraftAction =
  | { type: 'title'; value: string }
  | { type: 'description'; value: string }
  | { type: 'choose-type'; reportType: ReportType }
  | { type: 'source'; entityDefinitionId: string }
  | { type: 'filter'; filter: Predicate | null }
  | { type: 'settings'; patch: Record<string, unknown> }
  | { type: 'visualisation'; value: VisualisationType }
  | { type: 'reset'; draft: DraftState };

/** Applies an action; `leaf` resolves attribute types so the visualisation can be re-normalised. */
export function reduceDraft(state: DraftState, action: DraftAction, leaf: LeafResolver): DraftState {
  switch (action.type) {
    case 'title':
      return { ...state, title: action.value };
    case 'description':
      return { ...state, description: action.value };
    case 'reset':
      return action.draft;
    case 'choose-type': {
      const settings = defaultReportSettings(action.reportType);
      return {
        ...state,
        reportType: action.reportType,
        settings,
        visualisationType: normaliseVisualisationChoice(action.reportType, settings, null, leaf),
      };
    }
    case 'source': {
      if (action.entityDefinitionId === state.entityDefinitionId) return state;
      // A data-source change clears the filter, metric, grouping, segment and sort (builder §2.2).
      const settings = state.reportType ? defaultReportSettings(state.reportType) : null;
      return {
        ...state,
        entityDefinitionId: action.entityDefinitionId,
        filter: null,
        settings,
        visualisationType:
          state.reportType && settings ? normaliseVisualisationChoice(state.reportType, settings, null, leaf) : null,
      };
    }
    case 'filter':
      return { ...state, filter: action.filter };
    case 'settings': {
      if (!state.reportType || !state.settings) return state;
      const settings = { ...state.settings, ...action.patch } as ReportSettings;
      return {
        ...state,
        settings,
        visualisationType: normaliseVisualisationChoice(state.reportType, settings, state.visualisationType, leaf),
      };
    }
    case 'visualisation':
      return { ...state, visualisationType: action.value };
  }
}

/** Whether the draft differs from the saved report (or, for a new one, from an untouched draft). */
export function isDirty(draft: DraftState, saved: Report | null): boolean {
  const base = saved ? draftFromReport(saved) : emptyDraft();
  return JSON.stringify(normalise(draft)) !== JSON.stringify(normalise(base));
}

function normalise(d: DraftState): DraftState {
  return { ...d, title: d.title.trim(), description: d.description.trim() };
}

/** The server draft for `reporting.reportDataset` (null while the type or source is missing). */
export function toServerDraft(draft: DraftState): ReportDraft | null {
  if (!draft.entityDefinitionId || !draft.reportType || !draft.settings) return null;
  return {
    entityDefinitionId: draft.entityDefinitionId,
    filter: draft.filter,
    reportType: draft.reportType,
    visualisationType: draft.visualisationType,
    settings: draft.settings as unknown as Record<string, unknown>,
  };
}

/** Settings the chart draws with but the query does not read: editing them never refetches (builder §3.4–3.6). */
const PRESENTATIONAL = [
  'targetValue',
  'axisLabelVisible',
  'barSegmentsStacked',
  'sortPreference',
  'singleMetricDecimalPlaces',
  'mapDisplayType',
  'mapFitBounds',
];

/**
 * The draft reduced to what the dataset depends on: presentational settings and the visualisation fall away, and an
 * Insight's time range and comparison too (they are applied on the client; only the resolution is queried). The
 * dataset query is keyed by this, so those edits redraw without a request.
 */
export function queryDraft(draft: DraftState): DraftState {
  if (!draft.settings) return draft;
  const settings = { ...draft.settings } as Record<string, unknown>;
  for (const key of PRESENTATIONAL) delete settings[key];
  if (draft.reportType === 'insights' && settings.timeConfig) {
    settings.timeConfig = { ...(settings.timeConfig as object), duration: null, comparison: null };
  }
  return {
    ...draft,
    title: '',
    description: '',
    settings: settings as unknown as DraftState['settings'],
    visualisationType: draft.reportType === 'funnel' ? draft.visualisationType : null,
  };
}

/** Whether a title is blank (saved as typed; the UI shows "Untitled Report"). */
export const displayTitle = (title: string): string => (title.trim() ? title : 'Untitled Report');
