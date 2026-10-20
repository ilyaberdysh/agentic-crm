// Composer. Public API of the feature:
// openComposer(seed?) opens a new draft in the composer window (modal; `?modal=composer&id=<draft>`) and
// returns the draft id — record page "Compose email" / `c`, table "Send email", reply
// openDraft(id) reopens an existing draft (Drafts list)
// composeToRecords(…) "Send email" on selected records: a mass-send draft addressed to them
// The window itself (modal / minimised / pinned) is registered with the overlay host at module load.
import './register';

export { composeToRecords } from './compose';
export { type ComposerRecipient, type ComposerSeed, openComposer, openDraft } from './open';
