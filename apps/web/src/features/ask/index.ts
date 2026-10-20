// Ask AI (BACKLOG 10.01, 10.03, 10.04, 10.07, 10.16): the chat (full page, side panel on ⌘J, Home block), the
// prompts library and the AI record summary card. Public surface for other features (import from '../ask'):
//
//   openAsk(options?: OpenAskOptions): void
//     Opens the chat from anywhere (a header button, a menu item). `OpenAskOptions`:
//       context?:  AskContext     page context for the chat this opens = contracts `AiContext`:
//                                 { records?: {entityDefinitionId, entityInstanceId}[],
//                                   call?: {meetingId, callRecordingId, startTime?, endTime?},   // seconds
//                                   meeting?: {meetingId}, listId? }
//                                 It shows as the context chip of the composer and travels with every message.
//       mode?:     'panel' | 'page'   'panel' (default) = the right-hand side panel over the current page
//       threadId?: string         open an existing thread instead of a new chat
//       prompt?:   string         prefill the composer (not sent)
//       send?:     string         send this text at once as the first message of a new chat
//     Call page: `openAsk({ context: { call: { meetingId, callRecordingId } } })`; with a transcript selection add
//     `startTime` / `endTime` (seconds) — the chip then reads "<call title> · m:ss-m:ss".
//
//   <AskButton context? />    the "Ask AI" header button (secondary 28, speech bubble, tooltip with ⌘J):
//                             `openAsk({ context })`; without `context` it uses what pages registered (below).
//
//   useAskContext(context | null)
//     A page registers what it shows while mounted; ⌘J and every <AskButton/> then attach it without arguments.
//     The record page registers its record; the call page can register `{ call }` the same way (then a plain
//     <AskButton/> is all it needs). `openAsk({ context })` overrides the registered context for that chat.
//
//   closeAsk() / toggleAsk() / newAskChat()
//
// Mounted elsewhere (already wired): `AskHost` (workspace layout: ⌘J, the side panel, prompts modals), `askRoutes`
// (router: /chats/new?i=<context>, /chats/<id>), `ChatsSection` (sidebar), `HomeAsk` (Home), `SummaryCard`
// (record Overview), Settings → Ask AI pages (features/settings/ask).
export { AskButton } from './AskButton';
export {
  type AskContext,
  askStore,
  closeAsk,
  newAskChat,
  type OpenAskOptions,
  openAsk,
  toggleAsk,
  useAskUi,
} from './store';
export { useAskContext } from './useAskContext';
