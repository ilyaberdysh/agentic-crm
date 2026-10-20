// Object and attribute slugs (J objects-lists §2, §3.1; attribute-dialogs §7 "Change slug"). The create-object
// dialog fills the slug from the plural noun until the user edits it ("[seed] J Widgets" → "seed_j_widgets").
// The server owns uniqueness (409 SLUG_IN_USE); the client checks the charset (`apiSlugSchema`: a leading letter).

/** "[seed] J Widgets" → "seed_j_widgets": lower-case, diacritics folded, non-alphanumerics → one "_", trimmed. */
export function slugFromNoun(noun: string): string {
  return noun
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .replace(/_+$/g, '');
}

/** Mirrors `apiSlugSchema` in @agentic-crm/contracts. */
export const API_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isValidApiSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 64 && API_SLUG_PATTERN.test(slug);
}

export interface CreateObjectDraft {
  pluralNoun: string;
  singularNoun: string;
  apiSlug: string;
}

export type CreateObjectErrors = Partial<Record<keyof CreateObjectDraft, string>>;

/** Client validation of the create-object dialog, on submit (copy: J objects-lists §2). */
export function validateCreateObject(draft: CreateObjectDraft): CreateObjectErrors {
  const errors: CreateObjectErrors = {};
  if (!draft.pluralNoun.trim()) errors.pluralNoun = 'Please provide a plural noun for this object.';
  if (!draft.singularNoun.trim()) errors.singularNoun = 'Please provide a singular noun for this object.';
  const slug = draft.apiSlug.trim();
  if (!slug) errors.apiSlug = 'Please provide a unique slug for this object.';
  else if (!isValidApiSlug(slug))
    errors.apiSlug = 'Please ensure your slug is lowercase and contains only letters, numbers, and underscores.';
  return errors;
}

/** "Change slug" dialog check (objects and attributes). */
export const SLUG_FORMAT_ERROR = 'Slug must be lowercase and contain only letters, numbers and underscores.';

/** The sentence the user types to confirm a slug change. */
export function slugConfirmationPhrase(oldSlug: string): string {
  return `Integrations using "${oldSlug}" may be affected`;
}
