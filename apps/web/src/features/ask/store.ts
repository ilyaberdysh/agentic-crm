// UI state of Ask AI shared by every surface that can show the chat: the side panel (⌘J), the full page, the Home
// block and the buttons of other pages. A tiny external store (no React context): `openAsk()` can be called from any
// module, `useAskUi()` re-renders subscribers. The host (`AskHost`, mounted once in the workspace layout) turns
// requests into navigation.
//
// Page context ("interests", ask-agentic-internals §7.2): pages register what the user is looking at while mounted
// (`useAskContext`); the composer shows the high-prominence item as a chip and every turn carries it. `openAsk({context})`
// overrides the registered context for the chat it opens.
import type { AiContext } from '@agentic-crm/contracts';
import { useSyncExternalStore } from 'react';
import { newId } from '../../lib/ids';

export type { AiContext as AskContext };

export interface OpenAskOptions {
  /** Page context attached to the messages of the chat this opens (replaces the context pages registered). */
  context?: AiContext;
  /** `panel` (default): the right-hand side panel over the current page; `page`: the full-page chat. */
  mode?: 'panel' | 'page';
  /** An existing thread to open; default: a new chat. */
  threadId?: string;
  /** Text put into the composer (not sent). */
  prompt?: string;
  /** Text sent at once as the first message of a new chat. */
  send?: string;
}

export interface AskUiState {
  panelOpen: boolean;
  /** Thread shown in the side panel; null = a new chat (`newChatId` is minted for it). */
  panelThreadId: string | null;
  /** Client-minted id of the new chat being composed (idempotent create, I3). */
  newChatId: string;
  /** Context passed to `openAsk`; null = use the registered page contexts. */
  contextOverride: AiContext | null;
  /** Unsent composer text carried between the panel and the full page. */
  draft: string;
  /** A message the chat view sends as soon as it mounts (`openAsk({send})`, Home composer). */
  pendingSend: string | null;
  /** The host navigates to the full-page chat (`openAsk({mode:'page'})`). */
  pageRequest: { threadId: string | null; context: AiContext | null } | null;
}

let state: AskUiState = {
  panelOpen: false,
  panelThreadId: null,
  newChatId: newId(),
  contextOverride: null,
  draft: '',
  pendingSend: null,
  pageRequest: null,
};
const listeners = new Set<() => void>();
const registered = new Map<symbol, AiContext>();
let registeredVersion = 0;

function set(patch: Partial<AskUiState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const askStore = {
  get: (): AskUiState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set,
  /** Test hook: back to the initial state. */
  reset(): void {
    registered.clear();
    state = {
      panelOpen: false,
      panelThreadId: null,
      newChatId: newId(),
      contextOverride: null,
      draft: '',
      pendingSend: null,
      pageRequest: null,
    };
    for (const l of listeners) l();
  },
};

export function useAskUi(): AskUiState {
  return useSyncExternalStore(askStore.subscribe, askStore.get, askStore.get);
}

// ---- page context ---------------------------------------------------------------------------------------------------

/** Merges the contexts of every mounted page (records are concatenated; the latest call / meeting / list wins). */
export function mergeContexts(contexts: readonly AiContext[]): AiContext {
  const out: AiContext = {};
  const records = [...(out.records ?? [])];
  for (const c of contexts) {
    for (const r of c.records ?? []) {
      if (!records.some((x) => x.entityInstanceId === r.entityInstanceId)) records.push(r);
    }
    if (c.call) out.call = c.call;
    if (c.meeting) out.meeting = c.meeting;
    if (c.listId) out.listId = c.listId;
  }
  if (records.length > 0) out.records = records;
  return out;
}

/** Registers a page context; returns its disposer. Used by `useAskContext`. */
export function registerAskContext(context: AiContext): () => void {
  const id = Symbol('ask-context');
  registered.set(id, context);
  registeredVersion++;
  for (const l of listeners) l();
  return () => {
    registered.delete(id);
    registeredVersion++;
    for (const l of listeners) l();
  };
}

export function registeredContexts(): AiContext[] {
  return [...registered.values()];
}

/** The context the next message carries: the override of `openAsk`, else the merged page contexts. */
export function effectiveContext(s: AskUiState = state): AiContext {
  return s.contextOverride ?? mergeContexts(registeredContexts());
}

/** Re-renders when pages register or drop their context. */
export function useAskContextVersion(): number {
  return useSyncExternalStore(
    askStore.subscribe,
    () => registeredVersion,
    () => 0,
  );
}

// ---- opening and closing -----------------------------------------------------------------------------------------------

/** Opens Ask AI. See `OpenAskOptions`. Safe to call from anywhere (buttons, shortcuts, other features). */
export function openAsk(options: OpenAskOptions = {}): void {
  const { context, mode = 'panel', threadId, prompt, send } = options;
  if (mode === 'page') {
    set({
      panelOpen: false,
      pageRequest: { threadId: threadId ?? null, context: context ?? null },
      pendingSend: send ?? null,
      ...(prompt !== undefined ? { draft: prompt } : {}),
    });
    return;
  }
  const sameThread = (threadId ?? null) === state.panelThreadId;
  set({
    panelOpen: true,
    panelThreadId: threadId ?? null,
    // A new chat gets a fresh id unless the panel already shows the unsent new chat.
    newChatId: threadId || !sameThread ? newId() : state.newChatId,
    contextOverride: context ?? (sameThread ? state.contextOverride : null),
    draft: prompt !== undefined ? prompt : sameThread ? state.draft : '',
    pendingSend: send ?? null,
  });
}

/** Closes the side panel (the chat stays in the history). */
export function closeAsk(): void {
  set({ panelOpen: false, contextOverride: null });
}

/** ⌘J: closes the panel when it is open, else opens it with the current page context. */
export function toggleAsk(): void {
  if (state.panelOpen) closeAsk();
  else openAsk();
}

/** "New chat": a fresh empty chat in the panel. */
export function newAskChat(): void {
  set({ panelThreadId: null, newChatId: newId(), contextOverride: null, draft: '', pendingSend: null });
}
