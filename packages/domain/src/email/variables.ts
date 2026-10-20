// Placeholder variables (CROSS-DOMAIN B.11; F composer §2.6, §2.9–2.10): resolves a variable path against a
// recipient record. Each path step names an attribute (id or api slug) of the current record's object; reference
// attributes (company, associated deals, …) hop to the first referenced record; the last step's values are formatted
// as text (`field` picks a sub-field such as first_name of a personal name, locality of a location). Records the
// caller may not read resolve to null. Fallbacks are applied by the renderer, not here.
import { sql } from '@agentic-crm/db';
import { recordLabels } from '../collab/common.ts';
import type { Policies } from '../permissions.ts';
import type { ValueRow } from '../records/engine.ts';
import { type AttrDef, type DefInfo, isUuid, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

export interface VariableSpec {
  path: { entityDefinitionId?: string | null | undefined; attributeDefinitionId: string }[];
  field: string | null;
  fallback?: string | null;
}

const key = (s: string) => s.replace(/[_\s-]/g, '').toLowerCase();

function subField(json: unknown, field: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined;
  const wanted = key(field);
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (key(k) === wanted) return v;
  return undefined;
}

function formatNumber(v: string | number | null): string | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

export class VariableResolver {
  private readonly labels = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly policies: Policies,
  ) {}

  private async readable(def: DefInfo): Promise<boolean> {
    const memo = `variables-readable:${def.id}`;
    const cached = this.tx.memo.get(memo) as boolean | undefined;
    if (cached !== undefined) return cached;
    const allowed = (await this.policies.allowed(this.tx, [def], 'read_entity_instance')).length > 0;
    this.tx.memo.set(memo, allowed);
    return allowed;
  }

  private async values(instanceId: string, attr: AttrDef): Promise<ValueRow[]> {
    return this.tx.db
      .selectFrom('attribute_values')
      .selectAll()
      .where('instance_id', '=', instanceId)
      .where('attribute_id', '=', attr.id)
      .where('active_until', 'is', null)
      .orderBy('sort_order')
      .orderBy('active_from')
      .orderBy('id')
      .execute();
  }

  private async optionTitle(id: string): Promise<string | null> {
    const cached = this.labels.get(`opt:${id}`);
    if (cached !== undefined) return cached;
    const row = await this.tx.db.selectFrom('select_options').select('title').where('id', '=', id).executeTakeFirst();
    const title = row?.title ?? null;
    if (title !== null) this.labels.set(`opt:${id}`, title);
    return title;
  }

  private async memberName(id: string): Promise<string | null> {
    const row = await this.tx.db
      .selectFrom('workspace_members')
      .select(['first_name', 'last_name', 'email_address'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email_address;
  }

  private async format(attr: AttrDef, row: ValueRow, field: string | null): Promise<string | null> {
    const json = row.v_json as Record<string, unknown> | null;
    switch (attr.type) {
      case 'text':
        return row.v_text;
      case 'number':
      case 'rating':
        return formatNumber(row.v_num);
      case 'checkbox':
        return row.v_bool === null ? null : row.v_bool ? 'Yes' : 'No';
      case 'currency':
        return row.v_num === null ? null : `${formatNumber(row.v_num)} ${row.v_text ?? ''}`.trim();
      case 'date':
        return row.v_date;
      case 'timestamp':
      case 'interaction':
        return row.v_ts ? (row.v_ts as string).slice(0, 10) : null;
      case 'select':
      case 'pipeline':
        return row.v_ref ? this.optionTitle(row.v_ref) : null;
      case 'personal-name': {
        if (field) {
          const v = subField(json, field === 'full_name' ? 'fullName' : field);
          if (typeof v === 'string') return v || null;
        }
        return row.v_text;
      }
      case 'email-address':
      case 'domain':
      case 'phone-number':
      case 'location': {
        if (field) {
          const v = subField(json, field);
          if (typeof v === 'string' || typeof v === 'number') return String(v) || null;
          if (attr.type !== 'location') return row.v_text;
          return null;
        }
        if (attr.type === 'phone-number') return (json?.originalPhoneNumber as string | undefined) ?? row.v_text;
        if (attr.type === 'location') {
          const parts = ['line1', 'locality', 'region', 'postcode', 'countryCode']
            .map((k) => json?.[k])
            .filter((v): v is string => typeof v === 'string' && v !== '');
          return parts.length > 0 ? parts.join(', ') : null;
        }
        return row.v_text;
      }
      case 'actor-reference':
        return row.v_text === 'workspace-member' && row.v_ref ? this.memberName(row.v_ref) : null;
      case 'entity-reference': {
        if (!row.v_ref || !row.v_ref_def) return null;
        const labels = await recordLabels(this.tx, [
          { entityDefinitionId: row.v_ref_def, entityInstanceId: row.v_ref },
        ]);
        return labels.get(row.v_ref) ?? null;
      }
      default:
        return row.v_text;
    }
  }

  /** The value of one variable for one record (null = empty). */
  async resolve(
    record: { entityDefinitionId: string; entityInstanceId: string },
    variable: VariableSpec,
  ): Promise<string | null> {
    let def: DefInfo;
    try {
      def = await loadDefinition(this.tx, record.entityDefinitionId);
    } catch {
      return null;
    }
    let instanceId = record.entityInstanceId;
    for (let i = 0; i < variable.path.length; i++) {
      const step = variable.path[i] as VariableSpec['path'][number];
      if (step.entityDefinitionId && step.entityDefinitionId !== def.id && step.entityDefinitionId !== def.apiSlug) {
        return null;
      }
      if (!(await this.readable(def))) return null;
      const attr = def.byId.get(step.attributeDefinitionId) ?? def.bySlug.get(step.attributeDefinitionId);
      if (!attr) return null;
      if (attr.systemAttributeType === 'id') return i === variable.path.length - 1 ? instanceId : null;
      const rows = await this.values(instanceId, attr);
      const last = i === variable.path.length - 1;
      if (last) {
        const parts: string[] = [];
        for (const row of rows) {
          const text = await this.format(attr, row, variable.field);
          if (text !== null && text !== '') parts.push(text);
        }
        return parts.length > 0 ? parts.join(', ') : null;
      }
      const next = rows.find((r) => r.v_ref && r.v_ref_def);
      if (attr.type !== 'entity-reference' || !next) return null;
      try {
        def = await loadDefinition(this.tx, next.v_ref_def as string);
      } catch {
        return null;
      }
      instanceId = next.v_ref as string;
      const live = await sql<{ id: string }>`
        SELECT id FROM entity_instances WHERE id = ${instanceId} AND archived_at IS NULL AND merged_at IS NULL`.execute(
        this.tx.db,
      );
      if (live.rows.length === 0) return null;
    }
    return null;
  }

  /** Label of a variable chip when it has none: the attribute titles joined by " › ". */
  async label(rootDefinitionId: string, variable: VariableSpec): Promise<string> {
    const titles: string[] = [];
    let def: DefInfo | null = null;
    try {
      def = await loadDefinition(this.tx, rootDefinitionId);
    } catch {
      def = null;
    }
    for (const step of variable.path) {
      const ref = step.entityDefinitionId;
      if (ref && (!def || (def.id !== ref && def.apiSlug !== ref))) {
        try {
          def = await loadDefinition(this.tx, ref);
        } catch {
          def = null;
        }
      }
      const attr = def
        ? (def.byId.get(step.attributeDefinitionId) ?? def.bySlug.get(step.attributeDefinitionId))
        : null;
      titles.push(attr?.title ?? (isUuid(step.attributeDefinitionId) ? '?' : step.attributeDefinitionId));
      def = attr?.relatedEntityDefinitionId
        ? await loadDefinition(this.tx, attr.relatedEntityDefinitionId).catch(() => null)
        : attr?.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0]
          ? await loadDefinition(
              this.tx,
              attr.config.entityReferenceConfiguration.allowedEntityDefinitionIds[0] as string,
            ).catch(() => null)
          : null;
    }
    if (variable.field) titles.push(variable.field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
    return titles.join(' › ');
  }
}
