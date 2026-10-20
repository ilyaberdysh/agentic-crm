// Test fixtures: attribute definitions and value rows of every type (shared by unit tests and the dev gallery).
import type { AttributeDefinition, AttributeType, AttributeValue } from '../types';

export const WS_ID = '00000000-0000-4000-8000-0000000000aa';
export const OBJ_ID = '00000000-0000-4000-8000-0000000000b1';
export const RECORD_ID = '00000000-0000-4000-8000-0000000000c1';

let seq = 0;

export function attr(type: AttributeType, patch: Partial<AttributeDefinition> = {}): AttributeDefinition {
  const id =
    patch.id ??
    `10000000-0000-4000-8000-${type.length.toString(16).padStart(4, '0')}${(seq++).toString(16).padStart(8, '0')}`;
  return {
    id,
    workspaceId: WS_ID,
    entityDefinitionId: OBJ_ID,
    apiSlug: type.replace(/-/g, '_'),
    title: type.charAt(0).toUpperCase() + type.slice(1),
    description: '',
    type,
    isMultiselect: false,
    isUnique: false,
    isRequired: false,
    isHistoric: false,
    isArchived: false,
    isSystem: false,
    systemAttributeType: null,
    isReadOnly: false,
    isHidden: false,
    config: {},
    defaultValue: null,
    relationship: null,
    interfaceAttributeId: null,
    sortOrder: 'm',
    createdBy: { type: 'system', id: null },
    createdAt: '2026-01-01T00:00:00.000000Z',
    ...patch,
  };
}

export function row(
  attribute: AttributeDefinition,
  value: unknown,
  patch: Partial<AttributeValue> = {},
): AttributeValue {
  return {
    id: patch.id ?? `20000000-0000-4000-8000-${(seq++).toString(16).padStart(12, '0')}`,
    workspaceId: WS_ID,
    entityDefinitionId: attribute.entityDefinitionId,
    entityInstanceId: RECORD_ID,
    attributeDefinitionId: attribute.id,
    attributeType: attribute.type,
    value,
    activeFrom: '2026-10-09T13:00:00.000000Z',
    activeUntil: null,
    sortOrder: null,
    createdBy: { type: 'workspace-member', id: '30000000-0000-4000-8000-000000000001' },
    deactivatedBy: null,
    ...patch,
  };
}
