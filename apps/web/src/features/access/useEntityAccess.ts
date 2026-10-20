// UI gating from resolved action policies (BACKLOG 6.04; J permissions §3: `can(<flag>)`). One hook per object or list
// (an entity definition): what the member may do with its records, values, attributes and settings. Until the policy
// has loaded everything is allowed, so members with full access never see disabled controls flash; the server enforces
// the same flags on every write (a Read only member's write answers 403).
import { useQuery } from '@tanstack/react-query';
import { useAttributeEnv } from '../attributes/data/env';
import { policyQuery } from '../attributes/data/queries';

export interface EntityAccess {
  /** The policy has been resolved (until then every flag reads as allowed). */
  known: boolean;
  /** Open the object / list and read its records. */
  canRead: boolean;
  /** Edit values in cells, fields and cards. */
  canEditValues: boolean;
  /** New records / entries (also imports). */
  canCreateRecords: boolean;
  /** Delete one record, or many at once. */
  canDeleteRecords: boolean;
  canDeleteMany: boolean;
  /** Attribute management (create, edit, archive) and object configuration. */
  canCreateAttributes: boolean;
  canUpdateDefinition: boolean;
  /** The Permissions tab and the Share popover. */
  canAdministrate: boolean;
  /** Read only: may look but not change records (the "Read only" affordances). */
  isReadOnly: boolean;
}

export function useEntityAccess(entityDefinitionId: string | null | undefined): EntityAccess {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...policyQuery(workspace, entityDefinitionId ?? ''),
    enabled: Boolean(workspace.id && entityDefinitionId),
  });
  const policy = q.data ?? null;
  const can = (flag: keyof NonNullable<typeof policy>): boolean => {
    if (!policy) return true;
    const value = policy[flag];
    return typeof value === 'boolean' ? value : true;
  };
  const canRead = can('read_entity_instance');
  const canEditValues = can('update_attribute_value');
  const canCreateRecords = can('create_entity_instance');
  const canDeleteRecords = can('delete_entity_instance');
  return {
    known: policy !== null,
    canRead,
    canEditValues,
    canCreateRecords,
    canDeleteRecords,
    canDeleteMany: can('batch_delete_entity_instances'),
    canCreateAttributes: can('create_attribute_definition'),
    canUpdateDefinition: can('update_entity_definition'),
    canAdministrate: can('administrate_entity_definition_permissions'),
    isReadOnly: policy !== null && canRead && !canEditValues && !canCreateRecords && !canDeleteRecords,
  };
}
