// Resolution of raw cells for a compiled mapping (import.md I4 "server-side resolution"): per property a parse
// context (options, members, formats, the job's zone), the user's overrides keyed by SHA-256 of the raw value, and a
// memo per distinct raw value. Also assembles the values one strategy writes for one row.
import { createHash } from 'node:crypto';
import type { ValueInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import type { AttrDef } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type CompiledMapping, type CompiledProperty, parseContextBase, type StrategyNode } from './mapping.ts';
import type { JobRow } from './model.ts';
import {
  type MemberRef,
  type OptionRef,
  type ParseContext,
  type Resolution,
  resolveCell,
  splitFullName,
} from './parse.ts';

export const hashValue = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');

export interface ResolvedCell extends Resolution {
  overridden: boolean;
  /** The override (values null = skipped), when there is one. */
  override: { values: unknown[] | null } | null;
}

export class Resolver {
  private readonly contexts = new Map<string, ParseContext>();
  private readonly overrides = new Map<string, Map<string, unknown[] | null>>();
  private readonly memo = new Map<string, Map<string, ResolvedCell>>();

  private constructor(readonly compiled: CompiledMapping) {}

  static async load(tx: Tx, compiled: CompiledMapping, job: JobRow): Promise<Resolver> {
    const resolver = new Resolver(compiled);
    const props = compiled.properties;
    const optionAttrIds = [
      ...new Set(props.filter((p) => p.attr.type === 'select' || p.attr.type === 'pipeline').map((p) => p.attr.id)),
    ];
    const options = new Map<string, OptionRef[]>();
    if (optionAttrIds.length > 0) {
      const rows = await tx.db
        .selectFrom('select_options')
        .select(['id', 'attribute_id', 'title'])
        .where('attribute_id', 'in', optionAttrIds)
        .where('is_archived', '=', false)
        .orderBy('sort_order')
        .execute();
      for (const r of rows) options.set(r.attribute_id, [...(options.get(r.attribute_id) ?? []), r]);
    }
    let members: MemberRef[] = [];
    if (props.some((p) => p.attr.type === 'actor-reference')) {
      const rows = await tx.db
        .selectFrom('workspace_members')
        .select(['id', 'email_address', 'first_name', 'last_name'])
        .where('access_level', '!=', 'suspended')
        .execute();
      members = rows.map((r) => ({
        id: r.id,
        emailAddress: r.email_address,
        firstName: r.first_name,
        lastName: r.last_name,
      }));
    }
    for (const p of props) {
      resolver.contexts.set(p.row.id, {
        ...parseContextBase(p, job.time_zone),
        options: options.get(p.attr.id) ?? [],
        members,
      });
    }
    if (props.length > 0) {
      const rows = await tx.db
        .selectFrom('import_overrides')
        .select(['import_mapping_property_id', 'hashed_value', 'override_values'])
        .where(
          'import_mapping_property_id',
          'in',
          props.map((p) => p.row.id),
        )
        .execute();
      for (const r of rows) {
        let byHash = resolver.overrides.get(r.import_mapping_property_id);
        if (!byHash) {
          byHash = new Map();
          resolver.overrides.set(r.import_mapping_property_id, byHash);
        }
        byHash.set(r.hashed_value, (r.override_values as unknown[] | null) ?? null);
      }
    }
    return resolver;
  }

  context(prop: CompiledProperty): ParseContext {
    return this.contexts.get(prop.row.id) as ParseContext;
  }

  /** Parsed cell without overrides (the "Mapped value" before a fix). */
  parse(prop: CompiledProperty, raw: string): Resolution {
    return resolveCell(this.context(prop), raw);
  }

  resolve(prop: CompiledProperty, raw: string): ResolvedCell {
    let byRaw = this.memo.get(prop.row.id);
    if (!byRaw) {
      byRaw = new Map();
      this.memo.set(prop.row.id, byRaw);
    }
    const cached = byRaw.get(raw);
    if (cached) return cached;
    const overrides = this.overrides.get(prop.row.id);
    const hash = overrides && overrides.size > 0 ? hashValue(raw) : null;
    let out: ResolvedCell;
    if (hash !== null && overrides?.has(hash)) {
      const values = overrides.get(hash) ?? null;
      out = {
        values: values ?? [],
        errors: [],
        missing: [],
        empty: false,
        overridden: true,
        override: { values },
      };
    } else {
      out = { ...this.parse(prop, raw), overridden: false, override: null };
    }
    byRaw.set(raw, out);
    return out;
  }
}

/** The values one strategy writes for one row. */
export interface NodeRowValues {
  /** Attribute → inputs (Record / Entry ID excluded; it is only matched on). */
  values: Map<AttrDef, ValueInput[]>;
  /** Values of the matching column (unique attribute values or ids). */
  matchValues: unknown[];
  /** By attribute id, including Record / Entry ID: what the preview table shows. */
  display: Record<string, unknown[]>;
  hasData: boolean;
}

export function cellOf(cells: string[], prop: CompiledProperty): string {
  return cells[prop.row.column_index] ?? '';
}

export function nodeRowValues(resolver: Resolver, node: StrategyNode, cells: string[]): NodeRowValues {
  const values = new Map<AttrDef, ValueInput[]>();
  const display: Record<string, unknown[]> = {};
  let matchValues: unknown[] = [];
  const names = new Map<AttrDef, { full?: string; first?: string; last?: string }>();
  for (const prop of node.properties) {
    const res = resolver.resolve(prop, cellOf(cells, prop));
    if (prop === node.matchProperty) matchValues = res.values;
    if (res.values.length === 0) continue;
    if (prop.isId) {
      display[prop.attr.id] = res.values;
      continue;
    }
    if (prop.attr.type === 'personal-name') {
      const parts = names.get(prop.attr) ?? {};
      const text = String(res.values[0] ?? '');
      if (prop.field === 'first-name') parts.first = text;
      else if (prop.field === 'last-name') parts.last = text;
      else parts.full = text;
      names.set(prop.attr, parts);
      continue;
    }
    const list = values.get(prop.attr) ?? [];
    const seen = new Set(list.map((v) => JSON.stringify(v.value)));
    for (const v of res.values) {
      const key = JSON.stringify(v);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ value: v });
    }
    if (!prop.attr.isMultiselect && list.length > 1) list.splice(1);
    values.set(prop.attr, list);
  }
  for (const [attr, parts] of names) {
    const split = parts.full ? splitFullName(parts.full) : null;
    const firstName = parts.first ?? split?.firstName ?? '';
    const lastName = parts.last ?? split?.lastName ?? '';
    const fullName = parts.full ?? [firstName, lastName].filter(Boolean).join(' ');
    if (!firstName && !lastName && !fullName) continue;
    values.set(attr, [{ value: { firstName, lastName, fullName } }]);
  }
  for (const [attr, inputs] of values) display[attr.id] = inputs.map((i) => i.value);
  return { values, matchValues, display, hasData: values.size > 0 || matchValues.length > 0 };
}

/** Distinct raw values of a column with their row counts. */
export async function distinctValues(
  tx: Tx,
  jobId: string,
  columnIndex: number,
): Promise<{ raw: string; count: number }[]> {
  const { rows } = await sql<{ raw: string; n: number }>`
    SELECT coalesce(cells[${columnIndex + 1}], '') AS raw, count(*)::int AS n
    FROM import_job_rows WHERE import_job_id = ${jobId}::uuid
    GROUP BY 1`.execute(tx.db);
  return rows.map((r) => ({ raw: r.raw, count: Number(r.n) }));
}
