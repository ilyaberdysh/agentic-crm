// Labels of groups: the server resolves titles (meta.groups); the chart adds "No {attribute}", the deleted-option
// fallbacks and Yes / No for checkboxes (chart-types §5 "Labels inside charts").
import type { AttributeType, DatasetGroupInfo } from '@agentic-crm/contracts';
import { LABELS } from '../messages';

export interface GroupAttr {
  title: string;
  type: AttributeType | null;
}

/** "Primary location › Country" → "Country": the leaf of a path title. */
export function leafTitle(title: string): string {
  const i = title.lastIndexOf('›');
  return (i >= 0 ? title.slice(i + 1) : title).trim();
}

/** "No Start date". */
export const noValueLabel = (attr: GroupAttr | null): string => `No ${leafTitle(attr?.title ?? 'value')}`;

/** The label of a group key. */
export function groupLabel(info: DatasetGroupInfo | undefined, key: string | null, attr: GroupAttr | null): string {
  if (key === null) return noValueLabel(attr);
  if (attr?.type === 'checkbox') return key === 'true' ? LABELS.yes : LABELS.no;
  if (info?.label) return info.label;
  switch (attr?.type) {
    case 'pipeline':
      return LABELS.deletedStage;
    case 'select':
      return LABELS.deletedOption;
    case 'entity-reference':
      return LABELS.deletedRecord;
    case 'actor-reference':
      return LABELS.unknownActor;
    default:
      return key;
  }
}

/** Info of every key by key (the null key included). */
export function infoMap(infos: readonly DatasetGroupInfo[] | null | undefined): Map<string | null, DatasetGroupInfo> {
  return new Map((infos ?? []).map((i) => [i.key, i]));
}

/** Compares two keys by their natural `order` (the null group last, unknown keys after the known ones). */
export function naturalOrder(
  infos: Map<string | null, DatasetGroupInfo>,
): (a: string | null, b: string | null) => number {
  const rank = (k: string | null) => (k === null ? Number.POSITIVE_INFINITY : (infos.get(k)?.order ?? 1e9));
  return (a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  };
}
