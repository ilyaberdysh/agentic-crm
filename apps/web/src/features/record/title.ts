// Record title: the display-name attribute's value; "Unnamed Company" / "Unnamed Person" /
// "Unnamed {Singular}" when it is empty; the record id for objects without a name-like attribute.
import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import { useAttributeValues } from '../attributes';
import { titleFromValue } from '../attributes/data/queries';
import { useRecordPage } from './context';

export function unnamedTitle(object: Pick<EntityDefinition, 'entityType' | 'singularNoun'>): string {
  if (object.entityType === 'company-record') return 'Unnamed Company';
  if (object.entityType === 'person-record') return 'Unnamed Person';
  return `Unnamed ${object.singularNoun}`;
}

export interface TitleText {
  text: string;
  isLoading: boolean;
  /** The title is the record id (no name attribute). */
  isId: boolean;
}

export function useRecordTitleText(): TitleText {
  const { object, recordRef, titleAttribute } = useRecordPage();
  const fallbackAttr = titleAttribute ?? null;
  // Hooks run unconditionally: without a title attribute the values hook reads nothing (empty id).
  const values = useAttributeValues(
    fallbackAttr ? recordRef : { ...recordRef, entityInstanceId: '' },
    fallbackAttr ?? PLACEHOLDER_ATTRIBUTE,
  );
  if (!fallbackAttr) return { text: recordRef.entityInstanceId, isLoading: false, isId: true };
  const value = values.values[0]?.value;
  const text = value !== undefined ? titleFromValue(value) : '';
  return { text: text || (values.isLoading ? '' : unnamedTitle(object)), isLoading: values.isLoading, isId: false };
}

/** An inert attribute for hooks that must run without one (reads nothing: the record id is empty). */
export const PLACEHOLDER_ATTRIBUTE = {
  id: '',
  workspaceId: '',
  entityDefinitionId: '',
  apiSlug: '',
  title: '',
  description: '',
  type: 'text',
  isMultiselect: false,
  isUnique: false,
  isRequired: false,
  isHistoric: false,
  isArchived: false,
  isSystem: false,
  systemAttributeType: null,
  isReadOnly: true,
  isHidden: true,
  config: {},
  defaultValue: null,
  relationship: null,
  interfaceAttributeId: null,
  sortOrder: '',
  createdBy: { type: 'system', id: null },
  createdAt: new Date(0).toISOString(),
} satisfies AttributeDefinition;
