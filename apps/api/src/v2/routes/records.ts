// Records (A public-api-mapping §3 #29–35, #37, #40; data-model-documented §1.4, §3.1, §3.3–3.4, §8.2–8.5):
// query with filter/sort translation, create, assert by matching attribute, get, PATCH (append to multiselects),
// PUT (overwrite multiselects), delete and attribute values with history. Search is in routes/search.ts.

import type { Predicate } from '@agentic-crm/contracts';
import {
  type AttributeDefinition,
  type EntityDefinition,
  type RecordWithValues,
  rankSequence,
} from '@agentic-crm/contracts';
import {
  assertRecordBody,
  assertRecordQuery,
  createRecordBody,
  listRecordAttributeValuesQuery,
  queryRecordsBody,
  replaceRecordBody,
  updateRecordBody,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import type { V2Context } from '../context';
import { PublicApiError, publicErrors, toPublicError, withHints } from '../errors';
import { FilterTranslator } from '../filters';
import { loadValueLookups, recordToPublic, valueToPublic, visibleAttributes } from '../mappers';
import { page, params, parseInput, type RouteSpec } from '../route';
import { toInternalValues } from '../values';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Snapshot ranges and batch reads are paged internally; public pages may be larger. */
const RANGE = 5000;
const BATCH = 1000;
const DEFAULT_QUERY_LIMIT = 500;
/** COMINT (communication intelligence) attributes have no queryable history (records/list-record-attribute-values). */
const COMINT_SYSTEM_TYPES = new Set([
  'strongest-connection-strength',
  'strongest-connection-strength-enum',
  'strongest-connection-user',
]);

async function writableObject(v2: V2Context, key: string): Promise<EntityDefinition> {
  const def = await v2.object(key);
  if (def.isArchived) throw publicErrors.standardObjectDisabled(def.apiSlug);
  return def;
}

/** A path record id; malformed ids cannot name a record (same 404 as unknown ids). */
function recordIdParam(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) throw publicErrors.recordNotFound(raw ?? '');
  return raw.toLowerCase();
}

async function render(v2: V2Context, def: EntityDefinition, records: RecordWithValues[]) {
  const attrs = await v2.attributesOf(def.id);
  const lookups = await loadValueLookups(v2, visibleAttributes(attrs));
  return records.map((r) => recordToPublic(v2, def, r, attrs, lookups));
}

async function recordsByIds(v2: V2Context, def: EntityDefinition, ids: string[]): Promise<RecordWithValues[]> {
  const out: RecordWithValues[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { records } = await withHints({ object: def.apiSlug }, () =>
      v2.domain.records.batchGetWithValues(v2.ctx, { entityDefinitionId: def.id, entityInstanceIds: batch }),
    );
    out.push(...records);
  }
  return out;
}

/** Ordered ids of (filter | view filter, sorts) at [offset, offset + limit). */
async function queryIds(
  v2: V2Context,
  def: EntityDefinition,
  q: { filter: Predicate | null; viewId?: string; sorts: Awaited<ReturnType<FilterTranslator['sorts']>> },
  offset: number,
  limit: number,
): Promise<string[]> {
  if (limit === 0) return [];
  const first = await v2.domain.views.query(v2.ctx, {
    entityDefinitionId: def.id,
    ...(q.viewId ? { viewId: q.viewId } : { filter: q.filter }),
    sorts: q.sorts,
    initialRange: { start: offset, size: Math.min(limit, RANGE) },
  });
  const ids = [...first.ids];
  while (ids.length < limit && offset + ids.length < first.total) {
    const chunk = await v2.domain.views.chunk(v2.ctx, {
      snapshotId: first.snapshotId,
      start: offset + ids.length,
      size: Math.min(RANGE, limit - ids.length),
    });
    if (chunk.ids.length === 0) break;
    ids.push(...chunk.ids);
  }
  return ids;
}

function nonNegativeInteger(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw publicErrors.validation(`${name} must be a non-negative integer.`);
  return value;
}

/** Multiselect values added by PATCH are prepended (records/update-a-record-append-multiselect-values). */
async function prependRanks(
  v2: V2Context,
  def: EntityDefinition,
  recordId: string,
  values: Record<string, { value: unknown; sortOrder?: string }[]>,
  attributes: Map<string, AttributeDefinition>,
): Promise<void> {
  const multi = [...attributes.values()].filter((a) => a.isMultiselect && (values[a.id]?.length ?? 0) > 0);
  if (multi.length === 0) return;
  const current = await withHints({ object: def.apiSlug, recordId }, () =>
    v2.domain.records.get(v2.ctx, { entityDefinitionId: def.id, entityInstanceId: recordId }),
  );
  for (const attr of multi) {
    const ranks = (current.values[attr.id] ?? []).map((v) => v.sortOrder).filter((r): r is string => r !== null);
    const first = ranks.sort()[0];
    if (!first) continue;
    const inputs = values[attr.id] ?? [];
    rankSequence(inputs.length, null, first).forEach((rank, i) => {
      (inputs[i] as { sortOrder?: string }).sortOrder = rank;
    });
  }
}

export const recordRoutes: RouteSpec[] = [
  {
    method: 'POST',
    url: '/objects/:object/records/query',
    scopes: v2Operations.queryRecords.scopes,
    kind: 'read',
    async handler(v2, request) {
      const body = parseInput(queryRecordsBody, request.body ?? {}, 'request body');
      const def = await v2.object(params(request).object ?? '');
      if (body.filter !== undefined && body.filter_view_id !== undefined) {
        throw publicErrors.filterError('`filter` and `filter_view_id` cannot be used together.');
      }
      const translator = new FilterTranslator(v2);
      const filter = await translator.filter(def, body.filter);
      const sorts = await translator.sorts(def, body.sorts);
      const limit = nonNegativeInteger(body.limit, 'limit', DEFAULT_QUERY_LIMIT);
      const offset = nonNegativeInteger(body.offset, 'offset', 0);
      let ids: string[];
      try {
        ids = await queryIds(
          v2,
          def,
          { filter, sorts, ...(body.filter_view_id ? { viewId: body.filter_view_id } : {}) },
          offset,
          limit,
        );
      } catch (err) {
        const e = toPublicError(err, { object: def.apiSlug });
        // A filter_view_id that does not name a view of this object is a filter error (documented: 400 filter_error).
        if (body.filter_view_id && (e.statusCode === 404 || e.code === 'validation_type')) {
          throw publicErrors.filterError(`View with ID "${body.filter_view_id}" was not found on this object.`);
        }
        throw e;
      }
      return { data: await render(v2, def, await recordsByIds(v2, def, ids)) };
    },
  },
  {
    method: 'POST',
    url: '/objects/:object/records',
    scopes: v2Operations.createRecord.scopes,
    async handler(v2, request) {
      const body = parseInput(createRecordBody, request.body, 'request body');
      const def = await writableObject(v2, params(request).object ?? '');
      const { values } = await toInternalValues(v2, def, body.data.values);
      const created = await withHints({ object: def.apiSlug }, () =>
        v2.domain.records.create(v2.ctx, { entityDefinitionId: def.id, entityInstanceId: newId(), values }),
      );
      return { data: (await render(v2, def, [created]))[0] };
    },
  },
  {
    method: 'PUT',
    url: '/objects/:object/records',
    scopes: v2Operations.assertRecord.scopes,
    async handler(v2, request) {
      const query = parseInput(assertRecordQuery, request.query, 'query parameters');
      const body = parseInput(assertRecordBody, request.body, 'request body');
      const def = await writableObject(v2, params(request).object ?? '');
      const key = query.matching_attribute;
      const matchAttr = (await v2.attributesOf(def.id)).find(
        (a) => !a.isHidden && (a.apiSlug === key || a.id === key.toLowerCase()),
      );
      if (!matchAttr)
        throw publicErrors.valueNotFound(`No attribute was found for matching_attribute slug/ID "${key}".`);
      if (!matchAttr.isUnique) {
        throw new PublicApiError(
          400,
          'invalid_request_error',
          'matching_attribute_definition_not_unique',
          `The matching attribute "${matchAttr.apiSlug}" must be unique.`,
        );
      }
      const { values } = await toInternalValues(v2, def, body.data.values);
      const matchValues = values[matchAttr.id] ?? [];
      if (matchValues.length === 0) {
        throw publicErrors.missingValue(`A value for the matching attribute "${matchAttr.apiSlug}" was not provided.`);
      }
      const { entityInstanceIds } = await withHints({ object: def.apiSlug }, () =>
        v2.domain.records.findByUniqueValues(v2.ctx, {
          entityDefinitionId: def.id,
          attributeDefinitionId: matchAttr.id,
          values: matchValues,
        }),
      );
      if (entityInstanceIds.length > 1) {
        throw new PublicApiError(
          400,
          'invalid_request_error',
          'multiple_match_results',
          `Multiple records match the values given for the matching attribute "${matchAttr.apiSlug}".`,
        );
      }
      const existing = entityInstanceIds[0];
      const record = existing
        ? await withHints({ object: def.apiSlug, recordId: existing }, () =>
            v2.domain.records.update(v2.ctx, {
              entityDefinitionId: def.id,
              entityInstanceId: existing,
              values,
              // The matching attribute keeps its other values; every other multiselect is overwritten.
              multiselectMode: 'replace',
              multiselectModes: { [matchAttr.id]: 'append' },
            }),
          )
        : await withHints({ object: def.apiSlug }, () =>
            v2.domain.records.create(v2.ctx, { entityDefinitionId: def.id, entityInstanceId: newId(), values }),
          );
      return { data: (await render(v2, def, [record]))[0] };
    },
  },
  {
    method: 'GET',
    url: '/objects/:object/records/:record_id',
    scopes: v2Operations.getRecord.scopes,
    async handler(v2, request) {
      const p = params(request);
      const def = await v2.object(p.object ?? '');
      const recordId = recordIdParam(p.record_id);
      const record = await withHints({ object: def.apiSlug, recordId }, () =>
        v2.domain.records.get(v2.ctx, { entityDefinitionId: def.id, entityInstanceId: recordId }),
      );
      return { data: (await render(v2, def, [record]))[0] };
    },
  },
  ...(['PATCH', 'PUT'] as const).map(
    (method): RouteSpec => ({
      method,
      url: '/objects/:object/records/:record_id',
      scopes: method === 'PATCH' ? v2Operations.updateRecord.scopes : v2Operations.replaceRecord.scopes,
      async handler(v2, request) {
        const p = params(request);
        const body = parseInput(
          method === 'PATCH' ? updateRecordBody : replaceRecordBody,
          request.body,
          'request body',
        );
        const def = await writableObject(v2, p.object ?? '');
        const recordId = recordIdParam(p.record_id);
        const { values, attributes } = await toInternalValues(v2, def, body.data.values);
        const modes: Record<string, 'append' | 'replace'> = {};
        if (method === 'PATCH') {
          await prependRanks(v2, def, recordId, values, attributes);
          for (const attr of attributes.values()) modes[attr.id] = attr.isMultiselect ? 'append' : 'replace';
        }
        const record = await withHints({ object: def.apiSlug, recordId }, () =>
          v2.domain.records.update(v2.ctx, {
            entityDefinitionId: def.id,
            entityInstanceId: recordId,
            values,
            multiselectMode: 'replace',
            multiselectModes: modes,
          }),
        );
        return { data: (await render(v2, def, [record]))[0] };
      },
    }),
  ),
  {
    method: 'DELETE',
    url: '/objects/:object/records/:record_id',
    scopes: v2Operations.deleteRecord.scopes,
    async handler(v2, request) {
      const p = params(request);
      const def = await v2.object(p.object ?? '');
      const recordId = recordIdParam(p.record_id);
      const ref = { entityDefinitionId: def.id, entityInstanceId: recordId };
      await withHints({ object: def.apiSlug, recordId }, async () => {
        await v2.domain.records.get(v2.ctx, ref); // 404 for unknown and already deleted records
        await v2.domain.records.delete(v2.ctx, ref);
      });
      return {};
    },
  },
  {
    method: 'GET',
    url: '/objects/:object/records/:record_id/attributes/:attribute/values',
    scopes: v2Operations.listRecordAttributeValues.scopes,
    async handler(v2, request) {
      const p = params(request);
      const query = parseInput(listRecordAttributeValuesQuery, request.query, 'query parameters');
      const def = await v2.object(p.object ?? '');
      const recordId = recordIdParam(p.record_id);
      const attr = await v2.attribute(def, p.attribute ?? '');
      const ref = { entityDefinitionId: def.id, attributeDefinitionId: attr.id };
      const hints = { object: def.apiSlug, attribute: p.attribute ?? '', recordId };
      let rows: RecordWithValues['values'][string];
      if (query.show_historic) {
        if (attr.type === 'interaction' || COMINT_SYSTEM_TYPES.has(attr.systemAttributeType ?? '')) {
          throw publicErrors.validation('Cannot set show_historic param to true when querying a COMINT attribute.');
        }
        rows = [];
        let before: string | undefined;
        for (;;) {
          const batch = await withHints(hints, () =>
            v2.domain.values.history(v2.ctx, {
              ...ref,
              entityInstanceId: recordId,
              limit: 500,
              ...(before ? { before } : {}),
            }),
          );
          rows.push(...batch.values);
          if (batch.values.length < 500) break;
          before = batch.values.at(-1)?.activeFrom;
        }
        // History is read newest first; Attio returns it oldest to newest by active_from.
        rows.reverse();
      } else {
        const result = await withHints(hints, () =>
          v2.domain.values.list(v2.ctx, { ...ref, entityInstanceIds: [recordId] }),
        );
        const entry = result.values[recordId];
        if (!entry || entry.state !== 'complete') throw publicErrors.recordNotFound(recordId);
        rows = entry.value.values;
      }
      const lookups = await loadValueLookups(v2, [attr]);
      return { data: page(rows, query).map((row) => valueToPublic(row, attr, lookups)) };
    },
  },
];
