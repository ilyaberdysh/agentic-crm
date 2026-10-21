// Object icon tile colours: Companies and People use
// blue, Deals orange, Users cyan, Workspaces purple, custom objects grey.
import type { Hue, IconName } from '@agentic-crm/ui';
import type { ObjectSummary } from '../../data/objects';

export function objectAppearance(object: Pick<ObjectSummary, 'entityType' | 'standardObjectType'>): {
  icon: IconName;
  color: Hue;
} {
  switch (object.entityType) {
    case 'company-record':
      return { icon: 'company', color: 'blue' };
    case 'person-record':
      return { icon: 'person', color: 'blue' };
    case 'standard-object':
      if (object.standardObjectType === 'deal') return { icon: 'deal', color: 'orange' };
      if (object.standardObjectType === 'user') return { icon: 'user', color: 'cyan' };
      if (object.standardObjectType === 'workspace') return { icon: 'workspace', color: 'purple' };
      return { icon: 'object', color: 'grey' };
    default:
      return { icon: 'object', color: 'grey' };
  }
}

/** Fallback appearance for a standard-object route before its definition loads. */
export function slugAppearance(slug: string): { icon: IconName; color: Hue } {
  switch (slug) {
    case 'companies':
      return { icon: 'company', color: 'blue' };
    case 'people':
      return { icon: 'person', color: 'blue' };
    case 'deals':
      return { icon: 'deal', color: 'orange' };
    case 'users':
      return { icon: 'user', color: 'cyan' };
    case 'workspaces':
      return { icon: 'workspace', color: 'purple' };
    default:
      return { icon: 'object', color: 'grey' };
  }
}
