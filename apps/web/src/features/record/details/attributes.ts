// Which attributes the details panel shows (D README §2.3): configured section rows, else the first five attributes
// in attribute order; "View all values" lists every non-system attribute with fuzzy search by title. System and
// computed attributes (Record ID, interactions, connection strength, next due task, created at/by, list entries) are
// never listed.
import type { AttributeDefinition, EntityDefinition, LayoutElement } from '@agentic-crm/contracts';

const SYSTEM_ONLY = new Set([
  'id',
  'created-at',
  'created-by',
  'list-entries',
  'next-due-task',
  'strongest-connection-strength',
  'strongest-connection-strength-enum',
  'strongest-connection-user',
  'entry-parent-record',
]);

export function isListedAttribute(attribute: AttributeDefinition): boolean {
  if (attribute.isArchived || attribute.isHidden) return false;
  if (attribute.type === 'interaction') return false;
  return !SYSTEM_ONLY.has(attribute.systemAttributeType ?? '');
}

const byOrder = (a: AttributeDefinition, b: AttributeDefinition) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.createdAt.localeCompare(b.createdAt);

/** Every listed attribute in attribute order ("View all values", Edit record modal). */
export function listedAttributes(attributes: readonly AttributeDefinition[]): AttributeDefinition[] {
  return attributes.filter(isListedAttribute).sort(byOrder);
}

/** The rows of a Record Details section: its configured attributes, else the first five listed ones. */
export function sectionAttributes(
  attributes: readonly AttributeDefinition[],
  configured: readonly LayoutElement[],
): AttributeDefinition[] {
  if (configured.length > 0) {
    const byId = new Map(attributes.map((a) => [a.id, a]));
    return configured
      .map((el) => byId.get(el.path?.[0]?.attributeDefinitionId ?? ''))
      .filter((a): a is AttributeDefinition => a !== undefined && !a.isArchived);
  }
  return listedAttributes(attributes).slice(0, 5);
}

/** The display-name attribute (epithet path of one hop), used for the title, rename and breadcrumbs. */
export function titleAttributeOf(
  object: Pick<EntityDefinition, 'epithetPath'>,
  attributes: readonly AttributeDefinition[],
): AttributeDefinition | undefined {
  const hop = object.epithetPath?.length === 1 ? object.epithetPath[0] : undefined;
  return hop ? attributes.find((a) => a.id === hop.attributeDefinitionId) : undefined;
}

/** Fewest edits (insert / delete / substitute) that turn `query` into some substring of `text` (Sellers). */
export function substringDistance(query: string, text: string): number {
  let prev = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= query.length; i++) {
    const cur = new Array<number>(text.length + 1);
    cur[0] = i;
    for (let j = 1; j <= text.length; j++) {
      const cost = query[i - 1] === text[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j - 1] as number) + cost, (prev[j] as number) + 1, (cur[j - 1] as number) + 1);
    }
    prev = cur;
  }
  return Math.min(...prev);
}

/**
 * Fuzzy title match of "Search attributes..." (D §2.3: "inter" keeps "Twitter"): a substring, or a substring within
 * one edit for queries of four or more characters (two edits from eight).
 */
export function fuzzyMatches(query: string, title: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = title.toLowerCase();
  if (t.includes(q)) return true;
  const allowed = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  return allowed > 0 && substringDistance(q, t) <= allowed;
}
