// Highlights (D README §2.5): up to six widget cards from the layout's `widgets-v2` group. A widget shows one
// attribute of the record, or — for a multi-hop path such as "Associated people › Next interaction" — the attribute
// of the first related record. Select widgets show the option title and tint the card with the option colour;
// status widgets add a segmented bar of the pipeline stages with the current one highlighted.
import type { AttributeDefinition, AttributeValue, LayoutElement } from '@agentic-crm/contracts';
import { Icon, type IconName, toHue } from '@agentic-crm/ui';
import { vars } from '@agentic-crm/ui/styles';
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { attributesQuery, getAttributeUi, useAttributeValues, useSelectOptions, useStages } from '../../attributes';
import { titleFromValue } from '../../attributes/data/queries';
import { formatRelativeTime } from '../../attributes/format/formatValue';
import { read } from '../../attributes/values/shapes';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import { useWorkspace } from '../../shell/workspaceContext';
import { capitalize } from '../activity/events';
import { type RecordRef, useRecordPage } from '../context';
import { useRecordOpenTasks } from '../data';
import * as s from './overview.css';

const u = vars.color.utilities;

export function Highlights({ widgets }: { widgets: LayoutElement[] }) {
  if (widgets.length === 0) return null;
  return (
    <section className={s.section} aria-label="Highlights" data-testid="highlights">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>Highlights</h3>
      </div>
      <div className={s.grid}>
        {widgets.slice(0, 6).map((w) => (
          <Widget key={w.elementId} widget={w} />
        ))}
      </div>
    </section>
  );
}

function usePathAttributes(widget: LayoutElement): (AttributeDefinition | undefined)[] {
  const { workspace } = useWorkspace();
  const { attributes } = useRecordPage();
  const path = widget.path ?? [];
  const relatedDef = path[1]?.entityDefinitionId;
  const related = useQuery({ ...attributesQuery(workspace, relatedDef ?? ''), enabled: Boolean(relatedDef) });
  return path.map((hop, i) =>
    (i === 0 ? attributes : (related.data ?? [])).find((a) => a.id === hop.attributeDefinitionId),
  );
}

function Widget({ widget }: { widget: LayoutElement }) {
  const { recordRef } = useRecordPage();
  const attrs = usePathAttributes(widget);
  const first = attrs[0];
  const last = attrs[attrs.length - 1];
  const label =
    widget.title?.trim() ||
    attrs
      .map((a) => a?.title ?? '')
      .filter(Boolean)
      .join(' › ');
  const icon: IconName = first ? attributeIcon(first) : 'attrText';
  return (
    <div
      className={last?.type === 'pipeline' ? `${s.card} ${s.statusCard}` : s.card}
      data-testid="highlight-card"
      data-widget={last?.apiSlug}
    >
      {first && last && attrs.length === 1 ? (
        <DirectValue attribute={first} recordRef={recordRef} label={label} icon={icon} />
      ) : first && last ? (
        <PathValue head={first} tail={last} recordRef={recordRef} label={label} icon={icon} />
      ) : (
        <CardFrame label={label} icon={icon}>
          <span className={s.cardEmpty}>Unavailable</span>
        </CardFrame>
      )}
    </div>
  );
}

function CardFrame({
  label,
  icon,
  children,
  tint,
}: {
  label: string;
  icon: IconName;
  children: React.ReactNode;
  tint?: string;
}) {
  return (
    <>
      {tint && <TintLayer hue={tint} />}
      <div className={s.cardTop}>
        <span className={s.cardLabel} title={label}>
          {label}
        </span>
        <Icon icon={icon} size={16} className={s.cardIcon} />
      </div>
      <div className={s.cardValue}>{children}</div>
    </>
  );
}

/** Faint option-colour tint of select / status widgets (drawn behind the content, inside the 12 px radius). */
function TintLayer({ hue }: { hue: string }) {
  const h = toHue(hue);
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: 12,
    pointerEvents: 'none',
    background: `color-mix(in srgb, ${u.surface[`${h}Subtle` as keyof typeof u.surface]} 28%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${u.stroke[h as keyof typeof u.stroke] ?? 'transparent'} 70%, transparent)`,
  };
  return <span style={style} aria-hidden="true" />;
}

/** "No interaction", "No Connection", "No phone numbers", else "No {title}" (D §2.5, evidence D-*-overview). */
export function emptyWidgetText(attribute: AttributeDefinition): string {
  if (attribute.type === 'interaction') return 'No interaction';
  if (attribute.systemAttributeType?.startsWith('strongest-connection')) return 'No Connection';
  if (attribute.type === 'phone-number') return 'No phone numbers';
  return `No ${attribute.title}`;
}

function DirectValue({
  attribute,
  recordRef,
  label,
  icon,
}: {
  attribute: AttributeDefinition;
  recordRef: RecordRef;
  label: string;
  icon: IconName;
}) {
  const { values, isLoading } = useAttributeValues(recordRef, attribute);
  if (attribute.systemAttributeType === 'next-due-task') {
    return <NextDueTask attribute={attribute} recordRef={recordRef} label={label} icon={icon} />;
  }
  return <ValueBody attribute={attribute} values={values} isLoading={isLoading} label={label} icon={icon} />;
}

/**
 * "Next due task" (evidence D-overlay-from-view): the record's open task with the nearest deadline — title, and the
 * due time in amber ("In 2 days") below — read from the record's tasks.
 */
function NextDueTask({
  attribute,
  recordRef,
  label,
  icon,
}: {
  attribute: AttributeDefinition;
  recordRef: RecordRef;
  label: string;
  icon: IconName;
}) {
  const tasks = useRecordOpenTasks(recordRef);
  const next = (tasks.data?.tasks ?? [])
    .filter((t) => t.deadlineAt)
    .sort((a, b) => (a.deadlineAt as string).localeCompare(b.deadlineAt as string))[0];
  const overdue = next?.deadlineAt ? Date.parse(next.deadlineAt) < Date.now() : false;
  return (
    <CardFrame label={label} icon={icon}>
      {tasks.isPending ? null : !next ? (
        <span className={s.cardEmpty}>{emptyWidgetText(attribute)}</span>
      ) : (
        <>
          <span className={s.truncate}>{next.content.text}</span>
          <span className={overdue ? s.cardSubCritical : s.cardSubWarning}>
            {capitalize(formatRelativeTime(next.deadlineAt as string))}
          </span>
        </>
      )}
    </CardFrame>
  );
}

function PathValue({
  head,
  tail,
  recordRef,
  label,
  icon,
}: {
  head: AttributeDefinition;
  tail: AttributeDefinition;
  recordRef: RecordRef;
  label: string;
  icon: IconName;
}) {
  const hop = useAttributeValues(recordRef, head);
  const ref = read.reference(hop.values[0]?.value);
  const target = ref
    ? { entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId }
    : { entityDefinitionId: tail.entityDefinitionId, entityInstanceId: '' };
  const tailValues = useAttributeValues(target, tail);
  return (
    <ValueBody
      attribute={tail}
      values={ref ? tailValues.values : []}
      isLoading={hop.isLoading || (Boolean(ref) && tailValues.isLoading)}
      label={label}
      icon={icon}
    />
  );
}

function ValueBody({
  attribute,
  values,
  isLoading,
  label,
  icon,
}: {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  isLoading: boolean;
  label: string;
  icon: IconName;
}) {
  if (attribute.type === 'select')
    return <SelectValue attribute={attribute} values={values} label={label} icon={icon} />;
  if (attribute.type === 'pipeline')
    return <StatusValue attribute={attribute} values={values} label={label} icon={icon} />;
  const { View } = getAttributeUi(attribute.type);
  return (
    <CardFrame label={label} icon={icon}>
      {isLoading ? null : values.length === 0 ? (
        <span className={s.cardEmpty}>{emptyWidgetText(attribute)}</span>
      ) : (
        <span className={s.cardValueLine}>
          <View attribute={attribute} values={values} density="chip" />
        </span>
      )}
    </CardFrame>
  );
}

function SelectValue({
  attribute,
  values,
  label,
  icon,
}: {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  label: string;
  icon: IconName;
}) {
  const options = useSelectOptions(attribute);
  const chosen = values
    .map((v) => options.find((o) => o.id === read.select(v.value)))
    .filter((o): o is NonNullable<typeof o> => o !== undefined);
  const tint = chosen.length === 1 ? chosen[0]?.color : undefined;
  return (
    <CardFrame label={label} icon={icon} tint={tint}>
      {chosen.length === 0 ? (
        <span className={s.cardEmpty}>{emptyWidgetText(attribute)}</span>
      ) : (
        <span className={s.truncate}>{chosen.map((o) => o.title).join(', ')}</span>
      )}
    </CardFrame>
  );
}

function StatusValue({
  attribute,
  values,
  label,
  icon,
}: {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  label: string;
  icon: IconName;
}) {
  const stages = useStages(attribute).filter((st) => !st.isArchived);
  const currentId = read.pipeline(values[0]?.value);
  const current = stages.find((st) => st.id === currentId);
  return (
    <CardFrame label={label} icon={icon} tint={current?.color}>
      {!current ? (
        <span className={s.cardEmpty}>{emptyWidgetText(attribute)}</span>
      ) : (
        <>
          <span className={s.truncate}>{current.title}</span>
          <span className={s.stageBar} aria-hidden="true">
            {stages.map((st) => (
              <span
                key={st.id}
                className={s.stageSegment}
                style={{
                  backgroundColor: u.surface[toHue(st.color) as keyof typeof u.surface],
                  opacity: st.id === current.id ? 1 : 0.25,
                }}
              />
            ))}
          </span>
        </>
      )}
    </CardFrame>
  );
}

/** Text of a record reference value for compact places (preview panel). */
export function recordValueTitle(value: unknown): string {
  return titleFromValue(value);
}
