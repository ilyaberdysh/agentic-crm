// Model-facing renderings of workspace data (records, objects, members): compact JSON the AI layer puts into tool
// results, page context and summary prompts. Values are rendered as text (option titles, record names, member
// names), never as internal shapes. Callers check read access before rendering.
import type { AttributeValue } from '@agentic-crm/contracts';
import { recordLabels } from '../collab/common.ts';
import { recordOps } from '../records/service.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { runtimeValues, toText } from '../workflows/runtime.ts';

export interface RenderedRecord {
  object: string;
  entity_definition_id: string;
  entity_instance_id: string;
  name: string | null;
  /** Attribute title → rendered value (only attributes with values). */
  values?: Record<string, string>;
  /** Markdown link the model may copy into answers (renders as a record chip). */
  link: string;
}

/** Brackets and backslashes in the label are escaped (CommonMark), so "[seed] Jane" keeps its brackets in the chip. */
export const recordLink = (entityDefinitionId: string, entityInstanceId: string, label: string) =>
  `[${label.replace(/[[\]\\]/g, '\\$&')}](agentic-crm://entity-instance:${entityDefinitionId}/${entityInstanceId})`;

const SKIP_TYPES = new Set(['interaction']);
const MAX_VALUE_CHARS = 600;

async function memberNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'first_name', 'last_name', 'email_address'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((r) => [r.id, `${r.first_name} ${r.last_name}`.trim() || r.email_address]));
}

/** The attributes worth showing: not hidden, not interaction/system bookkeeping. */
export function visibleAttributes(def: DefInfo): AttrDef[] {
  return def.attrs.filter((a) => !a.isArchived && !a.isHidden && !SKIP_TYPES.has(a.type));
}

/** Renders one attribute's current values as text. */
async function renderValue(
  tx: Tx,
  attr: AttrDef,
  values: AttributeValue[],
  names: { records: Map<string, string | null>; members: Map<string, string> },
): Promise<string> {
  if (values.length === 0) return '';
  if (attr.type === 'entity-reference') {
    return values
      .map((v) => {
        const r = v.value as { entityInstanceId?: string };
        return (r.entityInstanceId && names.records.get(r.entityInstanceId)) || r.entityInstanceId || '';
      })
      .filter(Boolean)
      .join(', ');
  }
  if (attr.type === 'actor-reference') {
    return values
      .map((v) => names.members.get((v.value as { referencedActorId?: string }).referencedActorId ?? '') ?? '')
      .filter(Boolean)
      .join(', ');
  }
  if (attr.type === 'currency') {
    return values
      .map((v) => {
        const c = v.value as { currencyValue?: number; currencyCode?: string | null };
        return `${c.currencyValue ?? ''}${c.currencyCode ? ` ${c.currencyCode}` : ''}`;
      })
      .join(', ');
  }
  const runtime = await runtimeValues(tx, attr, values);
  return toText(runtime);
}

/**
 * Renders records of one definition (missing / deleted ids are dropped). `withValues` adds every visible attribute
 * that has a value (texts capped at 600 chars).
 */
export async function renderRecords(
  tx: Tx,
  defRef: string | DefInfo,
  ids: string[],
  options: { withValues?: boolean } = {},
): Promise<RenderedRecord[]> {
  const def = typeof defRef === 'string' ? await loadDefinition(tx, defRef) : defRef;
  if (ids.length === 0) return [];
  const labels = await recordLabels(
    tx,
    ids.map((id) => ({ entityDefinitionId: def.id, entityInstanceId: id })),
  );
  const { records } = await recordOps.batchGetWithValues(tx, { entityDefinitionId: def.id, entityInstanceIds: ids });
  const attrs = options.withValues ? visibleAttributes(def) : [];
  const refIds: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  const memberIds: string[] = [];
  for (const r of records) {
    for (const attr of attrs) {
      for (const v of r.values[attr.id] ?? []) {
        if (attr.type === 'entity-reference') {
          const ref = v.value as { entityDefinitionId?: string; entityInstanceId?: string };
          if (ref.entityDefinitionId && ref.entityInstanceId) {
            refIds.push({ entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId });
          }
        } else if (attr.type === 'actor-reference') {
          const id = (v.value as { referencedActorId?: string }).referencedActorId;
          if (id) memberIds.push(id);
        }
      }
    }
  }
  const names = { records: await recordLabels(tx, refIds), members: await memberNames(tx, memberIds) };
  const out: RenderedRecord[] = [];
  for (const r of records) {
    const id = r.record.entityInstanceId;
    const values: Record<string, string> = {};
    for (const attr of attrs) {
      const text = await renderValue(tx, attr, r.values[attr.id] ?? [], names);
      if (text) values[attr.title] = text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
    }
    const name = labels.get(id) ?? null;
    out.push({
      object: def.apiSlug,
      entity_definition_id: def.id,
      entity_instance_id: id,
      name,
      ...(options.withValues ? { values } : {}),
      link: recordLink(def.id, id, name ?? def.singularNoun),
    });
  }
  return out;
}

/** Markdown of a rich-text document projection, falling back to plain text. */
export function documentText(content: { markdown?: string | null; plaintext?: string | null } | undefined): string {
  if (!content) return '';
  return content.markdown || content.plaintext || '';
}

/** "Ada Lovelace" for member ids. */
export { memberNames };
