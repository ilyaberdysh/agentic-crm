// The table of the Preview and Overview steps (C2; evidence import-4-preview, import-5-overview-*):
// a narrow outcome column (green + create, blue ↻ update, grey ⊘ skip; overview: red ⚠ failed with the reason on
// hover), then one column per attribute the strategy writes, values drawn with the attribute Views.
import type { AttributeDefinition, PathHop } from '@agentic-crm/contracts';
import { Icon, type IconName, IconTile, Tooltip } from '@agentic-crm/ui';
import { getAttributeUi } from '../../attributes';
import { objectAppearance } from '../../shell/objectAppearance';
import { attributeIcon } from '../../views/operators';
import type { SchemaIndex } from '../../views/schemaIndex';
import type { FailureReason, PlanRow, PlanStrategy, RowStatus } from '../data/contract';
import { ValueView } from './values';
import * as s from './wizard.css';

export const FAILURE_TEXT: Record<FailureReason, string> = {
  'unknown-error': 'An unknown error occurred',
  'entity-definition-not-found': 'Object not found',
  'invalid-value': 'Invalid value provided',
  'attribute-definition-not-found': 'Attribute not found',
  'matching-values-missing': 'Matching values missing',
  'matching-attribute-definition-not-found': 'Matching attribute not found',
  'matching-attribute-definition-not-unique': 'Matching attribute not unique',
  'matching-entity-instance-not-found': 'No matching record found',
  'matching-entity-instance-is-merging': 'The matched record is currently merging',
  'multiple-matching-entity-instances': 'Multiple matches found',
  'linked-record-not-found': 'The linked record was not found',
  'permission-denied': 'Permission denied',
  'required-value-not-provided': 'A required value was not provided',
  'unique-constraint-violation': 'Unique attribute conflict',
  'unsupported-attribute-type': 'Unsupported attribute type',
  'unique-value-attribute-type-not-supported': 'Matching attribute type does not support unique value lookup',
  'particle-gate-violation': 'Blocked due to object rules violation',
  'retries-exceeded': 'An unknown error occurred',
};

type Tone = 'create' | 'update' | 'skip' | 'failed' | 'planned';

const OUTCOME: Record<PlanRow['outcome'], { icon: IconName; tone: Tone; label: string }> = {
  create: { icon: 'add', tone: 'create', label: 'Will be created' },
  update: { icon: 'refresh', tone: 'update', label: 'Will be updated' },
  skip: { icon: 'skip', tone: 'skip', label: 'Will be skipped' },
};

const STATUS: Record<RowStatus, { icon: IconName; tone: Tone; label: string }> = {
  planned: { icon: 'empty', tone: 'planned', label: 'Planned' },
  created: { icon: 'add', tone: 'create', label: 'Created' },
  updated: { icon: 'refresh', tone: 'update', label: 'Updated' },
  skipped: { icon: 'skip', tone: 'skip', label: 'Skipped' },
  failed: { icon: 'warning', tone: 'failed', label: 'Failed' },
  canceled: { icon: 'skip', tone: 'skip', label: 'Canceled' },
};

export function OutcomeIcon({ icon, tone, size = 16 }: { icon: IconName; tone: Tone; size?: number }) {
  return (
    <span className={`${s.outcomeIcon} ${s.outcomeTone[tone]}`} style={{ width: size, height: size }}>
      <Icon icon={icon} size={size - 4} />
    </span>
  );
}

/** Tabs per object written ("[seed] Projects 3"; lists: "List entries 2" first, then the parent object). */
export function StrategyTabs({
  strategies,
  selected,
  index,
  onSelect,
}: {
  strategies: PlanStrategy[];
  selected: string;
  index: SchemaIndex | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={s.tabsRow} role="tablist" aria-label="Objects">
      {strategies.map((st) => {
        const def = index?.definition(st.entityDefinitionId);
        const title = st.kind === 'entries' ? 'List entries' : (def?.pluralNoun ?? 'Records');
        const look =
          def && st.kind !== 'entries' ? objectAppearance(def as Parameters<typeof objectAppearance>[0]) : null;
        return (
          <button
            key={st.id}
            type="button"
            role="tab"
            aria-selected={st.id === selected}
            data-selected={st.id === selected || undefined}
            className={s.strategyTab}
            onClick={() => onSelect(st.id)}
          >
            {look ? (
              <IconTile icon={look.icon} color={look.color} size={16} />
            ) : (
              <IconTile icon="list" color="grey" size={16} />
            )}
            {title}
            <span className={s.groupCount}>{st.total}</span>
          </button>
        );
      })}
    </div>
  );
}

function widthOf(attribute: AttributeDefinition | undefined): number {
  if (attribute?.type === 'checkbox') return 100;
  return 180;
}

export function ResultsTable({
  strategy,
  index,
  rows,
  mode,
}: {
  strategy: PlanStrategy;
  index: SchemaIndex | null;
  rows: PlanRow[];
  mode: 'preview' | 'overview';
}) {
  const columns = strategy.attributeIds.map((id) =>
    index?.attribute({ entityDefinitionId: strategy.entityDefinitionId, attributeDefinitionId: id } as PathHop),
  );
  return (
    <div className={s.tableScroll} data-testid="results-table">
      <table className={s.table} style={{ width: 42 + columns.reduce((n, a) => n + widthOf(a), 0) }}>
        <colgroup>
          <col style={{ width: 42 }} />
          {columns.map((a, i) => (
            <col key={i} style={{ width: widthOf(a) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={s.th} aria-label="Outcome" />
            {columns.map((a, i) => (
              <th key={i} className={s.th}>
                <span className={s.thInner}>
                  <Icon icon={a ? attributeIcon(a) : 'attrText'} size={14} className={s.thIcon} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a?.title ?? 'Deleted attribute'}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const look = mode === 'preview' ? OUTCOME[row.outcome] : STATUS[row.status];
            const label =
              mode === 'overview' && row.status === 'failed' && row.failureReason
                ? FAILURE_TEXT[row.failureReason]
                : look.label;
            return (
              <tr key={row.row} data-testid="result-row" data-outcome={row.outcome} data-status={row.status}>
                <td className={s.tdOutcome}>
                  <Tooltip content={label}>
                    <span tabIndex={0} aria-label={label} style={{ display: 'inline-flex', outline: 'none' }}>
                      <OutcomeIcon icon={look.icon} tone={look.tone} />
                    </span>
                  </Tooltip>
                </td>
                {columns.map((a, i) => {
                  const id = strategy.attributeIds[i] as string;
                  const values = row.values[id] ?? [];
                  return (
                    <td
                      key={i}
                      className={s.td}
                      style={{ textAlign: a && getAttributeUi(a.type).align === 'end' ? 'right' : 'left' }}
                    >
                      <div className={s.cellBox}>
                        {a && values.length > 0 && <ValueView attribute={a} values={values} />}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
