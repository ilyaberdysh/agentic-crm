// Entry points that open the composer window (F composer §1). The draft is created at once with a client-minted id
// (idempotent, I3) so the window can open instantly; the window waits for the draft before showing the editor.
import type { Block } from '@agentic-crm/editor';
import { newId } from '../../lib/ids';
import { openWindow } from '../overlays';

export interface ComposerRecipient {
  emailAddress: string;
  name?: string | null;
  /** The person record the address belongs to (variables merge from it). */
  record?: { entityDefinitionId: string; entityInstanceId: string } | null;
}

/** What a new draft starts with (all optional). */
export interface ComposerSeed {
  to?: ComposerRecipient[];
  cc?: ComposerRecipient[];
  bcc?: ComposerRecipient[];
  subject?: string;
  body?: Block[];
  /** Mass sending ("Send email" on a table selection). */
  isMassSend?: boolean;
  /** Reply / forward: the synced message the draft answers. */
  parentMessageId?: string;
  /** "Use template": subject and body come from the template. */
  templateId?: string;
}

/** Registered by `./session` (kept out of this module so callers do not pull in the window code). */
let starter: ((id: string, seed: ComposerSeed) => void) | null = null;

export function setComposerStarter(fn: (id: string, seed: ComposerSeed) => void): void {
  starter = fn;
}

/** Opens a new draft in the composer window and returns its id. */
export function openComposer(seed: ComposerSeed = {}, options: { mode?: 'modal' | 'floating' } = {}): string {
  const id = newId();
  starter?.(id, seed);
  openWindow('composer', id, { mode: options.mode ?? 'modal' });
  return id;
}

/** Reopens an existing draft (Drafts list row). */
export function openDraft(id: string): void {
  openWindow('composer', id, { mode: 'modal' });
}
