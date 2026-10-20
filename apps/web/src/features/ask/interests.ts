// Page context in a URL (ask-agentic §1: `/chats/new?i=<base64 JSON interests>`): the full-page chat opened from a record
// page, ⌘K or a button carries what the user was looking at. Ours is the base64url JSON of an `AiContext`.
import { type AiContext, aiContextSchema } from '@agentic-crm/contracts';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The `i` search param of a context; undefined when there is nothing to carry. */
export function encodeInterests(context: AiContext | null | undefined): string | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;
  return toBase64Url(JSON.stringify(context));
}

/** The context of an `i` search param; null for anything that is not a valid context. */
export function decodeInterests(value: string | null | undefined): AiContext | null {
  if (!value) return null;
  try {
    const parsed = aiContextSchema.safeParse(JSON.parse(fromBase64Url(value)));
    return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : null;
  } catch {
    return null;
  }
}
