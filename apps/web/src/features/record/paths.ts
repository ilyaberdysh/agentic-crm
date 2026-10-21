// Record page URLs: `/company/<id>`, `/person/<id>`, `/<deals|users|workspaces>/record/<id>`,
// `/custom/<slug>/record/<id>`, each followed by `/<activeTab>`.
import type { EntityDefinition } from '@agentic-crm/contracts';

type ObjectRoute = Pick<EntityDefinition, 'entityType' | 'apiSlug'>;

/** Path below `/<workspaceSlug>/` of a record page, without the tab. */
export function recordSubPath(object: ObjectRoute, entityInstanceId: string): string {
  if (object.entityType === 'person-record') return `person/${entityInstanceId}`;
  if (object.entityType === 'company-record') return `company/${entityInstanceId}`;
  if (object.entityType === 'custom-record') return `custom/${object.apiSlug}/record/${entityInstanceId}`;
  return `${object.apiSlug}/record/${entityInstanceId}`;
}

/** Full URL path (`href` = the workspace's path builder). */
export function recordUrl(
  href: (path?: string) => string,
  object: ObjectRoute,
  entityInstanceId: string,
  tab?: string,
): string {
  const base = href(recordSubPath(object, entityInstanceId));
  return tab ? `${base}/${tab}` : base;
}

/** The api slug of the object a record route belongs to (`company` → companies, `person` → people). */
export function routeObjectSlug(segment: 'company' | 'person'): string {
  return segment === 'company' ? 'companies' : 'people';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
