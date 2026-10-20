// Zod validation of client → server realtime messages (the TS contract is ClientToServer in @agentic-crm/realtime).
import type { ClientToServer } from '@agentic-crm/realtime';
import { z } from 'zod';

/** `<namespace>:<workspaceId>[:<param>…]`, e.g. `record:<ws>:<definitionId>:<instanceId>` (realtime.md §3). */
export const ROOM_PATTERN =
  /^([a-z][a-z0-9_-]{0,63}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})((?::[A-Za-z0-9._-]{1,128}){0,6})$/;

export const MAX_STATE_BYTES = 8 * 1024;
export const MAX_EPHEMERAL_BYTES = 32 * 1024;

const seq = z.string().regex(/^\d{1,19}$/);
const room = z.string().max(512).regex(ROOM_PATTERN, 'room must be <namespace>:<workspaceId>[:<param>...]');
const json = (maxBytes: number) =>
  z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= maxBytes, { message: `must be at most ${maxBytes} bytes` });

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe-workspace'), workspaceId: z.uuid(), after: seq.optional() }),
  z.object({ type: z.literal('unsubscribe-workspace'), workspaceId: z.uuid() }),
  z.object({ type: z.literal('join-room'), room, state: json(MAX_STATE_BYTES).optional() }),
  z.object({ type: z.literal('leave-room'), room }),
  z.object({ type: z.literal('room-state'), room, state: json(MAX_STATE_BYTES) }),
  z.object({ type: z.literal('room-ephemeral'), room, payload: json(MAX_EPHEMERAL_BYTES) }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Compile-time guard: every validated message is a valid ClientToServer.
const _contract: (m: ClientMessage) => ClientToServer = (m) => m;
void _contract;

export function parseRoom(name: string): { namespace: string; workspaceId: string; params: string[] } | null {
  const match = ROOM_PATTERN.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const params = match[3] ? match[3].slice(1).split(':') : [];
  return { namespace: match[1], workspaceId: match[2], params };
}
