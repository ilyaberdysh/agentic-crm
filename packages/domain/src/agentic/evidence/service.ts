import { uuidSchema } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { badRequest, conflict, forbidden, notFound } from '../../errors.ts';
import type { Tx } from '../../tx.ts';
import { canonicalDigest, canonicalJson, sha256 } from './canonical.ts';
import {
  type CaptureEvidenceInput,
  captureEvidenceSchema,
  type Evidence,
  type EvidenceSnapshot,
  type EvidenceSource,
  evidenceSnapshotSchema,
} from './contracts.ts';

type EvidenceRow = { id: string; digest: string; snapshot: EvidenceSnapshot };
const sameScope = (a: EvidenceSnapshot['scope'], b: EvidenceSnapshot['scope']) =>
  a.entityDefinitionId === b.entityDefinitionId && a.entityInstanceId === b.entityInstanceId;

export function createEvidenceService(source: EvidenceSource) {
  async function sourceFor(
    tx: Tx,
    ref: EvidenceSnapshot['source'] | CaptureEvidenceInput['source'],
    scope: EvidenceSnapshot['scope'],
  ) {
    const live = await source.load(tx, ref, scope);
    if (!live || live.workspaceId !== tx.workspaceId) return null;
    const member = await tx.db
      .selectFrom('workspace_members')
      .select('id')
      .where('workspace_id', '=', tx.workspaceId)
      .where('id', '=', live.readerMemberId)
      .where('removed_at', 'is', null)
      .where('access_level', 'in', ['admin', 'member'])
      .executeTakeFirst();
    if (!member || !live.audienceMemberIds.includes(member.id)) throw forbidden('Evidence source access denied');
    return live;
  }

  async function stored(tx: Tx, id: string): Promise<EvidenceRow> {
    uuidSchema.parse(id);
    const { rows } = await sql<EvidenceRow>`SELECT id, digest, snapshot FROM agentic_evidence
      WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${id}::uuid`.execute(tx.db);
    if (!rows[0]) throw notFound('Evidence not found');
    const row = { ...rows[0], snapshot: evidenceSnapshotSchema.parse(rows[0].snapshot) };
    if (canonicalDigest(row.snapshot) !== row.digest) throw conflict('ID_CONFLICT', 'Evidence digest mismatch');
    return row;
  }

  /** Freshness/access check for the broker. It returns no captured text when the source is stale. */
  async function inspect(tx: Tx, id: string): Promise<{ state: 'current'; evidence: Evidence } | { state: 'stale' }> {
    const row = await stored(tx, id);
    const live = await sourceFor(tx, row.snapshot.source, row.snapshot.scope);
    if (!live) return { state: 'stale' };
    if (!row.snapshot.source.audienceMemberIds.includes(live.readerMemberId))
      throw forbidden('Evidence was not captured for this reader');
    if (
      !sameScope(live.scope, row.snapshot.scope) ||
      live.version !== row.snapshot.source.version ||
      sha256(live.text) !== row.snapshot.source.contentHash ||
      live.primary !== row.snapshot.source.primary
    )
      return { state: 'stale' };
    const rejected = await sql<{ id: string }>`SELECT id FROM agentic_evidence
      WHERE workspace_id = ${tx.workspaceId}::uuid AND entity_instance_id = ${row.snapshot.scope.entityInstanceId}::uuid
      AND snapshot->>'band' = 'REJECTED' AND snapshot->>'claim' = ${row.snapshot.claim}
      AND snapshot->'source'->>'contentHash' = ${row.snapshot.source.contentHash} LIMIT 1`.execute(tx.db);
    if (row.snapshot.band !== 'REJECTED' && rejected.rows.length > 0) return { state: 'stale' };
    return { state: 'current', evidence: row };
  }

  return {
    inspect,
    async read(tx: Tx, id: string): Promise<Evidence> {
      const result = await inspect(tx, id);
      if (result.state !== 'current') throw conflict('ID_CONFLICT', 'Evidence source is stale or unavailable');
      return result.evidence;
    },
    async capture(tx: Tx, input: CaptureEvidenceInput): Promise<Evidence> {
      const parsed = captureEvidenceSchema.parse(input);
      // Lock the id even before insertion, so concurrent retries observe the committed immutable row.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.workspaceId}:evidence:${parsed.id}`}, 0))`.execute(
        tx.db,
      );
      const existing = await sql<EvidenceRow>`SELECT id, digest, snapshot FROM agentic_evidence
        WHERE workspace_id = ${tx.workspaceId}::uuid AND id = ${parsed.id}::uuid`.execute(tx.db);
      if (existing.rows[0]) {
        const inspected = await inspect(tx, parsed.id);
        if (inspected.state !== 'current') throw conflict('ID_CONFLICT', 'Evidence source is stale or unavailable');
        const row = inspected.evidence;
        const old = row.snapshot;
        if (
          canonicalJson({
            scope: old.scope,
            source: { kind: old.source.kind, id: old.source.id },
            band: old.band,
            claim: old.claim,
            fragment: old.fragment,
          }) !==
          canonicalJson({
            scope: parsed.scope,
            source: parsed.source,
            band: parsed.band,
            claim: parsed.claim,
            fragment: parsed.fragment,
          })
        )
          throw conflict('ID_CONFLICT', 'Evidence id already binds different content');
        return row;
      }
      const live = await sourceFor(tx, parsed.source, parsed.scope);
      if (!live || !sameScope(live.scope, parsed.scope)) throw forbidden('Evidence source or record scope denied');
      if (
        parsed.fragment.end <= parsed.fragment.start ||
        live.text.slice(parsed.fragment.start, parsed.fragment.end) !== parsed.fragment.quote
      )
        throw badRequest('VALIDATION_ERROR', 'Evidence quotation does not match the exact source fragment');
      if (parsed.band === 'VERIFIED' && !live.primary) throw forbidden('Verified evidence requires a primary source');
      const snapshot = evidenceSnapshotSchema.parse({
        contractVersion: 1,
        workspaceId: tx.workspaceId,
        scope: parsed.scope,
        source: {
          ...parsed.source,
          version: live.version,
          contentHash: sha256(live.text),
          primary: live.primary,
          audienceMemberIds: [...new Set(live.audienceMemberIds)].sort(),
          retentionClass: 'workspace',
          deletionState: 'live',
        },
        band: parsed.band,
        claim: parsed.claim,
        fragment: parsed.fragment,
        capturedBy: tx.ctx.actor,
        capturedAt: tx.now,
      });
      if (parsed.band !== 'REJECTED') {
        const rejected = await sql<{ id: string }>`SELECT id FROM agentic_evidence
          WHERE workspace_id = ${tx.workspaceId}::uuid AND entity_instance_id = ${parsed.scope.entityInstanceId}::uuid
          AND snapshot->>'band' = 'REJECTED' AND snapshot->>'claim' = ${parsed.claim}
          AND snapshot->'source'->>'contentHash' = ${snapshot.source.contentHash} LIMIT 1`.execute(tx.db);
        if (rejected.rows.length) throw conflict('ID_CONFLICT', 'Rejected claim requires materially new evidence');
      }
      const digest = canonicalDigest(snapshot);
      await sql`INSERT INTO agentic_evidence
        (id, workspace_id, entity_definition_id, entity_instance_id, snapshot, digest, created_by)
        VALUES (${parsed.id}::uuid, ${tx.workspaceId}::uuid, ${parsed.scope.entityDefinitionId}::uuid,
          ${parsed.scope.entityInstanceId}::uuid, ${JSON.stringify(snapshot)}::jsonb, ${digest}, ${JSON.stringify(tx.ctx.actor)}::jsonb)`.execute(
        tx.db,
      );
      tx.emit('record-timeline', parsed.scope.entityDefinitionId, {
        entityDefinitionId: parsed.scope.entityDefinitionId,
        entityInstanceIds: [parsed.scope.entityInstanceId],
      });
      return { id: parsed.id, digest, snapshot };
    },
  };
}
export type EvidenceService = ReturnType<typeof createEvidenceService>;
