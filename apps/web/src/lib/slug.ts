// Workspace handles (K legacy-welcome §6.5): while untouched the handle follows the kebab-case of the company name;
// validation lower-cases and kebab-cases the input. The server owns the reserved list and uniqueness.

/** "Acme, Inc." → "acme-inc"; diacritics folded, anything else non-alphanumeric becomes a single hyphen. */
export function kebabCase(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** Mirrors `workspaceSlugSchema` in @agentic-crm/contracts. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 64 && SLUG_PATTERN.test(slug);
}
