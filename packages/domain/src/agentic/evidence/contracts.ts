import { actorSchema, agenticRecordScopeSchema, uuidSchema } from '@agentic-crm/contracts';
import { z } from 'zod';
import type { Tx } from '../../tx.ts';

export const evidenceBandSchema = z.enum(['VERIFIED', 'PROBABLE', 'CONFLICTED', 'REJECTED']);
export type EvidenceBand = z.infer<typeof evidenceBandSchema>;
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const evidenceSourceRefSchema = z.strictObject({ kind: z.literal('crm.note'), id: uuidSchema });
export type EvidenceSourceRef = z.infer<typeof evidenceSourceRefSchema>;
export const captureEvidenceSchema = z.strictObject({
  id: uuidSchema,
  scope: agenticRecordScopeSchema,
  source: evidenceSourceRefSchema,
  band: evidenceBandSchema,
  claim: z.string().trim().min(1).max(4000),
  fragment: z.strictObject({
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(8000),
  }),
});
export type CaptureEvidenceInput = z.input<typeof captureEvidenceSchema>;

export const evidenceSnapshotSchema = z.strictObject({
  contractVersion: z.literal(1),
  workspaceId: uuidSchema,
  scope: agenticRecordScopeSchema,
  source: evidenceSourceRefSchema.extend({
    version: z.string().min(1).max(200),
    contentHash: digestSchema,
    primary: z.boolean(),
    audienceMemberIds: z.array(uuidSchema).min(1),
    retentionClass: z.literal('workspace'),
    deletionState: z.literal('live'),
  }),
  band: evidenceBandSchema,
  claim: z.string(),
  fragment: captureEvidenceSchema.shape.fragment,
  capturedBy: actorSchema,
  capturedAt: z.string(),
});
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;
export interface Evidence {
  id: string;
  digest: string;
  snapshot: EvidenceSnapshot;
}

/**
 * Trusted, database-only integration, never tool/model/request input. load authenticates the current reader
 * (including the live delegated member for an agent), resolves the note's exact record scope and document
 * version, and computes its current source audience. Missing source/deletion/retention expiry returns null.
 * Only a primary source may set primary=true; model output or a derived summary must set it false.
 * No connector ACL replication is implemented here.
 */
export interface EvidenceSource {
  load(
    tx: Tx,
    source: EvidenceSourceRef,
    scope: EvidenceSnapshot['scope'],
  ): Promise<{
    workspaceId: string;
    scope: EvidenceSnapshot['scope'];
    version: string;
    text: string;
    primary: boolean;
    audienceMemberIds: string[];
    readerMemberId: string;
  } | null>;
}
