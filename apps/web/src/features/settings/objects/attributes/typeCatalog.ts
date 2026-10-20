// The "Create attribute" type picker and the data-type labels of the attributes table (J attribute-dialogs §2–3,
// A attribute-types §1). The picker offers 16 entries; Multi-select and Relationship map onto `select` and
// `entity-reference`; Formula is a pseudo-type (an attribute of its output type with a formula configuration; the
// editor lives in features/formulas). The "AI Autofill" shortcuts are features/ai-attributes' PICKER_SHORTCUTS.
import type { AttributeDefinition, AttributeType } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';

export type PickerType =
  | 'checkbox'
  | 'currency'
  | 'date'
  | 'formula'
  | 'location'
  | 'multi-select'
  | 'number'
  | 'phone-number'
  | 'rating'
  | 'record'
  | 'relationship'
  | 'select'
  | 'status'
  | 'text'
  | 'timestamp'
  | 'user';

export interface PickerEntry {
  id: PickerType;
  label: string;
  icon: IconName;
  /** Internal type sent on create (Formula's default output type is text). */
  type: AttributeType;
}

/** Alphabetical, as in the picker's "Type" group. */
export const PICKER_ENTRIES: readonly PickerEntry[] = [
  { id: 'checkbox', label: 'Checkbox', icon: 'attrCheckbox', type: 'checkbox' },
  { id: 'currency', label: 'Currency', icon: 'attrCurrency', type: 'currency' },
  { id: 'date', label: 'Date', icon: 'attrDate', type: 'date' },
  { id: 'formula', label: 'Formula', icon: 'attrFormula', type: 'text' },
  { id: 'location', label: 'Location', icon: 'attrLocation', type: 'location' },
  { id: 'multi-select', label: 'Multi-select', icon: 'attrMultiSelect', type: 'select' },
  { id: 'number', label: 'Number', icon: 'attrNumber', type: 'number' },
  { id: 'phone-number', label: 'Phone Number', icon: 'attrPhone', type: 'phone-number' },
  { id: 'rating', label: 'Rating', icon: 'attrRating', type: 'rating' },
  { id: 'record', label: 'Record', icon: 'attrRecord', type: 'entity-reference' },
  { id: 'relationship', label: 'Relationship', icon: 'link', type: 'entity-reference' },
  { id: 'select', label: 'Select', icon: 'attrSelect', type: 'select' },
  { id: 'status', label: 'Status', icon: 'attrStatus', type: 'pipeline' },
  { id: 'text', label: 'Text', icon: 'attrText', type: 'text' },
  { id: 'timestamp', label: 'Timestamp', icon: 'attrTimestamp', type: 'timestamp' },
  { id: 'user', label: 'User', icon: 'attrActor', type: 'actor-reference' },
];

export function pickerEntry(id: PickerType): PickerEntry {
  return PICKER_ENTRIES.find((e) => e.id === id) as PickerEntry;
}

/** Picker entries for an object (lists do not offer Relationship; attribute-types §1). */
export function pickerEntriesFor(target: 'object' | 'list'): readonly PickerEntry[] {
  return target === 'list' ? PICKER_ENTRIES.filter((e) => e.id !== 'relationship') : PICKER_ENTRIES;
}

type AttrShape = Pick<AttributeDefinition, 'type' | 'isMultiselect' | 'relationship'> &
  Partial<Pick<AttributeDefinition, 'formulaConfiguration'>>;

/** The picker entry an existing attribute belongs to (the disabled Type select of the edit dialog). */
export function pickerTypeOf(attr: AttrShape): PickerType | null {
  if (attr.formulaConfiguration) return 'formula';
  switch (attr.type) {
    case 'select':
      return attr.isMultiselect ? 'multi-select' : 'select';
    case 'entity-reference':
      return attr.relationship ? 'relationship' : 'record';
    case 'pipeline':
      return 'status';
    case 'actor-reference':
      return 'user';
    case 'text':
    case 'number':
    case 'checkbox':
    case 'currency':
    case 'date':
    case 'timestamp':
    case 'rating':
    case 'location':
    case 'phone-number':
      return attr.type;
    default:
      return null;
  }
}

const SYSTEM_TYPE_LABEL: Partial<Record<AttributeType, string>> = {
  domain: 'Domain',
  'email-address': 'Email address',
  interaction: 'Interaction',
  'personal-name': 'Name',
};

const SYSTEM_TYPE_ICON: Partial<Record<AttributeType, IconName>> = {
  domain: 'attrDomain',
  'email-address': 'attrEmail',
  interaction: 'attrInteraction',
  'personal-name': 'attrPersonalName',
};

/** "Data type" column label and filter label (J attribute-dialogs §1). */
export function dataTypeLabel(attr: AttrShape): string {
  const picker = pickerTypeOf(attr);
  return picker ? pickerEntry(picker).label : (SYSTEM_TYPE_LABEL[attr.type] ?? attr.type);
}

/** Row icon of an attribute: by system role first (Record ID is "#"), then by type. */
export function attributeIcon(attr: AttrShape & Pick<AttributeDefinition, 'systemAttributeType'>): IconName {
  switch (attr.systemAttributeType) {
    case 'id':
      return 'attrNumber';
    case 'next-due-task':
      return 'tasks';
    case 'list-entries':
      return 'list';
    default:
      break;
  }
  const picker = pickerTypeOf(attr);
  return picker ? pickerEntry(picker).icon : (SYSTEM_TYPE_ICON[attr.type] ?? 'attrText');
}

export interface ConstraintSet {
  required: boolean;
  unique: boolean;
  multiple: boolean;
}

/** Constraint checkboxes shown per picker type (J attribute-dialogs §3 table; attribute-types §2). */
export function constraintsFor(type: PickerType): ConstraintSet {
  switch (type) {
    case 'select':
    case 'multi-select':
      return { required: true, unique: false, multiple: false };
    case 'record':
    case 'user':
    case 'phone-number':
      return { required: true, unique: true, multiple: true };
    case 'relationship':
    case 'formula':
      return { required: false, unique: false, multiple: false };
    default:
      return { required: true, unique: true, multiple: false };
  }
}

/** Types whose create form shows the (disabled for now) AI autofill card (J attribute-dialogs §3). */
export function hasAiAutofillCard(type: PickerType): boolean {
  return type === 'text' || type === 'number' || type === 'currency' || type === 'select' || type === 'multi-select';
}
