// Internal (domain) shapes → Attio's public /v2 shapes (A public-api-mapping §1–2): composite ids, renamed types
// (pipeline → status, entity-reference → record-reference), snake_case value fields, public actor types and
// nanosecond-precision timestamps.
import type {
  Actor,
  AttributeDefinition,
  AttributeType,
  AttributeValue,
  EntityDefinition,
  PipelineStage,
  RecordWithValues,
  SelectOption,
  WorkspaceMember,
} from '@agentic-crm/contracts';
import type { OptionLike, V2Context } from './context';

export type PublicAttributeType =
  | Exclude<AttributeType, 'pipeline' | 'entity-reference'>
  | 'status'
  | 'record-reference';

export function publicType(type: AttributeType): PublicAttributeType {
  if (type === 'pipeline') return 'status';
  if (type === 'entity-reference') return 'record-reference';
  return type;
}

export function internalType(type: string): AttributeType | null {
  if (type === 'status') return 'pipeline';
  if (type === 'record-reference') return 'entity-reference';
  if (type === 'pipeline' || type === 'entity-reference') return null;
  const known: readonly string[] = [
    'text',
    'number',
    'checkbox',
    'currency',
    'date',
    'timestamp',
    'rating',
    'select',
    'actor-reference',
    'location',
    'domain',
    'email-address',
    'phone-number',
    'interaction',
    'personal-name',
  ];
  return known.includes(type) ? (type as AttributeType) : null;
}

/** '2026-10-10T12:00:00.123456Z' → '2026-10-10T12:00:00.123456000Z' (Attio returns nanosecond precision). */
export function attioTimestamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(iso);
  if (!m) return new Date(iso).toISOString().replace(/\.(\d{3})Z$/, '.$1000000Z');
  return `${m[1]}.${(m[2] ?? '').padEnd(9, '0').slice(0, 9)}Z`;
}

const PUBLIC_ACTOR_TYPES = new Set(['workspace-member', 'api-token', 'system', 'app']);

/** Internal actor → public actor; internal-only types (enrichment, comint, workflows, imports…) read as `system`. */
export function publicActor(actor: Actor | null): { type: string | null; id: string | null } {
  if (!actor) return { type: null, id: null };
  if (!PUBLIC_ACTOR_TYPES.has(actor.type) || actor.type === 'system') return { type: 'system', id: null };
  return { type: actor.type, id: actor.id };
}

export function objectToPublic(def: EntityDefinition) {
  return {
    id: { workspace_id: def.workspaceId, object_id: def.id },
    api_slug: def.apiSlug,
    singular_noun: def.singularNoun,
    plural_noun: def.pluralNoun,
    created_at: attioTimestamp(def.createdAt),
  };
}

export function memberToPublic(m: WorkspaceMember) {
  return {
    id: { workspace_id: m.workspaceId, workspace_member_id: m.id },
    first_name: m.firstName,
    last_name: m.lastName,
    avatar_url: null,
    email_address: m.emailAddress,
    created_at: attioTimestamp(m.createdAt),
    access_level: m.accessLevel,
  };
}

export function selectOptionToPublic(o: SelectOption) {
  return {
    id: {
      workspace_id: o.workspaceId,
      object_id: o.entityDefinitionId,
      attribute_id: o.attributeDefinitionId,
      option_id: o.id,
    },
    title: o.title,
    is_archived: o.isArchived,
  };
}

export function statusToPublic(s: PipelineStage) {
  return {
    id: {
      workspace_id: s.workspaceId,
      object_id: s.entityDefinitionId,
      attribute_id: s.attributeDefinitionId,
      status_id: s.id,
    },
    title: s.title,
    is_archived: s.isArchived,
    celebration_enabled: s.celebrationEnabled,
    target_time_in_status: s.targetTimeInStatus,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Values

/** Longest-prefix country of an E.164 number (Attio always returns a country code for phone values). */
// biome-ignore format: compact table
const CALLING_CODES: Record<string, string> = {
  '1': 'US', '7': 'RU', '20': 'EG', '27': 'ZA', '30': 'GR', '31': 'NL', '32': 'BE', '33': 'FR', '34': 'ES', '36': 'HU',
  '39': 'IT', '40': 'RO', '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE', '47': 'NO', '48': 'PL', '49': 'DE',
  '51': 'PE', '52': 'MX', '54': 'AR', '55': 'BR', '56': 'CL', '57': 'CO', '60': 'MY', '61': 'AU', '62': 'ID', '63': 'PH',
  '64': 'NZ', '65': 'SG', '66': 'TH', '81': 'JP', '82': 'KR', '84': 'VN', '86': 'CN', '90': 'TR', '91': 'IN', '92': 'PK',
  '351': 'PT', '353': 'IE', '357': 'CY', '358': 'FI', '370': 'LT', '371': 'LV', '372': 'EE', '374': 'AM', '375': 'BY',
  '380': 'UA', '381': 'RS', '420': 'CZ', '852': 'HK', '966': 'SA', '971': 'AE', '972': 'IL', '994': 'AZ', '995': 'GE',
  '998': 'UZ',
};

export function countryOfPhoneNumber(e164: string): string | null {
  const digits = e164.replace(/^\+/, '');
  for (let n = 3; n >= 1; n--) {
    const country = CALLING_CODES[digits.slice(0, n)];
    if (country) return country;
  }
  return null;
}

/** Catalog data a value needs to be rendered (object slugs for references, options/statuses by id). */
export interface ValueLookups {
  objectSlugs: Map<string, string>;
  options: Map<string, OptionLike>;
}

export async function loadValueLookups(v2: V2Context, attrs: AttributeDefinition[]): Promise<ValueLookups> {
  const defs = await v2.allDefinitions();
  const options = new Map<string, OptionLike>();
  for (const attr of attrs) {
    if (attr.type !== 'select' && attr.type !== 'pipeline') continue;
    for (const o of await v2.optionsOf(attr)) options.set(o.id, o);
  }
  return { objectSlugs: new Map(defs.map((d) => [d.id, d.apiSlug])), options };
}

type R = Record<string, unknown>;

/** The type-specific fields of a value (no envelope). `value` is the domain read form. */
export function valueFields(attr: AttributeDefinition, value: unknown, lookups: ValueLookups): R {
  const v = (value ?? {}) as R;
  switch (attr.type) {
    case 'text':
    case 'number':
    case 'rating':
    case 'checkbox':
    case 'date':
      return { value };
    case 'timestamp':
      return { value: typeof value === 'string' ? attioTimestamp(value) : value };
    case 'currency':
      return {
        currency_value: v.currencyValue,
        currency_code: v.currencyCode ?? attr.config.currencyConfiguration?.defaultCurrencyCode ?? null,
      };
    case 'pipeline': {
      const stage = lookups.options.get(v.pipelineStageId as string) as PipelineStage | undefined;
      return { status: stage ? statusToPublic(stage) : v.pipelineStageId };
    }
    case 'select': {
      const option = lookups.options.get(v.selectOptionId as string) as SelectOption | undefined;
      return { option: option ? selectOptionToPublic(option) : v.selectOptionId };
    }
    case 'entity-reference':
      return {
        target_object: lookups.objectSlugs.get(v.entityDefinitionId as string) ?? v.entityDefinitionId,
        target_record_id: v.entityInstanceId,
      };
    case 'actor-reference': {
      const actor = publicActor({ type: v.referencedActorType as Actor['type'], id: v.referencedActorId as string });
      return { referenced_actor_type: actor.type, referenced_actor_id: actor.type === 'system' ? null : actor.id };
    }
    case 'location':
      return {
        line_1: v.line1 ?? null,
        line_2: v.line2 ?? null,
        line_3: v.line3 ?? null,
        line_4: v.line4 ?? null,
        locality: v.locality ?? null,
        region: v.region ?? null,
        postcode: v.postcode ?? null,
        country_code: v.countryCode ?? null,
        latitude: v.latitude ?? null,
        longitude: v.longitude ?? null,
      };
    case 'domain':
      return { domain: v.normalizedDomain, root_domain: v.rootDomain };
    case 'email-address':
      return {
        original_email_address: v.originalEmailAddress ?? v.normalizedEmailAddress,
        email_address: v.normalizedEmailAddress,
        email_domain: v.emailDomain,
        email_root_domain: v.emailRootDomain,
        email_local_specifier: v.emailLocalSpecifier,
      };
    case 'phone-number':
      return {
        original_phone_number: v.originalPhoneNumber,
        country_code: v.countryCode ?? countryOfPhoneNumber(String(v.normalizedPhoneNumber ?? '')),
        phone_number: v.normalizedPhoneNumber,
      };
    case 'interaction':
      return {
        interaction_type: v.interactionType,
        interacted_at: typeof v.interactedAt === 'string' ? attioTimestamp(v.interactedAt) : v.interactedAt,
        owner_actor: v.ownerMembershipId
          ? { type: 'workspace-member', id: v.ownerMembershipId }
          : { type: null, id: null },
      };
    case 'personal-name':
      return { first_name: v.firstName ?? '', last_name: v.lastName ?? '', full_name: v.fullName ?? '' };
  }
}

/** A stored value row → Attio's value object (envelope + fields). */
export function valueToPublic(row: AttributeValue, attr: AttributeDefinition, lookups: ValueLookups): R {
  return {
    active_from: attioTimestamp(row.activeFrom),
    active_until: row.activeUntil ? attioTimestamp(row.activeUntil) : null,
    created_by_actor: publicActor(row.createdBy),
    ...valueFields(attr, row.value, lookups),
    attribute_type: publicType(attr.type),
  };
}

/** Attributes shown on public records: not hidden, not archived. */
export function visibleAttributes(attrs: AttributeDefinition[]): AttributeDefinition[] {
  return attrs.filter((a) => !a.isHidden && !a.isArchived);
}

export function webUrl(base: string, workspaceSlug: string, def: EntityDefinition, recordId: string): string {
  const root = `${base.replace(/\/$/, '')}/${workspaceSlug}`;
  switch (def.entityType) {
    case 'person-record':
      return `${root}/person/${recordId}`;
    case 'company-record':
      return `${root}/company/${recordId}`;
    case 'standard-object':
      return `${root}/${def.apiSlug}/record/${recordId}`;
    default:
      return `${root}/custom/${def.apiSlug}/record/${recordId}`;
  }
}

export function recordToPublic(
  v2: V2Context,
  def: EntityDefinition,
  record: RecordWithValues,
  attrs: AttributeDefinition[],
  lookups: ValueLookups,
) {
  const values: Record<string, R[]> = {};
  for (const attr of visibleAttributes(attrs)) {
    values[attr.apiSlug] = (record.values[attr.id] ?? []).map((row) => valueToPublic(row, attr, lookups));
  }
  return {
    id: { workspace_id: record.record.workspaceId, object_id: def.id, record_id: record.record.entityInstanceId },
    created_at: attioTimestamp(record.record.createdAt),
    web_url: webUrl(v2.webUrl, v2.identity.workspace.slug, def, record.record.entityInstanceId),
    values,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Attributes

function defaultValueToPublic(attr: AttributeDefinition, lookups: ValueLookups): R | null {
  const dv = attr.defaultValue;
  if (!dv) return null;
  if (dv.type === 'dynamic') return { type: 'dynamic', template: dv.identifier };
  let template: unknown[] = [];
  try {
    const parsed = JSON.parse(dv.identifier) as unknown;
    template = Array.isArray(parsed) ? parsed : [];
  } catch {
    template = [];
  }
  return {
    type: 'static',
    // Template values are bare values (the `output-value` schema): no active_from/active_until/created_by_actor.
    template: template.map((value) => ({
      ...valueFields(attr, readFormOfDefault(attr, value), lookups),
      attribute_type: publicType(attr.type),
    })),
  };
}

/** Static defaults are stored in write form; the few types whose read form differs are converted. */
function readFormOfDefault(attr: AttributeDefinition, value: unknown): unknown {
  if (attr.type === 'currency' && typeof value === 'object' && value !== null) {
    return { currencyCode: null, ...(value as R) };
  }
  return value;
}

export interface RelatedAttribute {
  attribute: AttributeDefinition;
  objectSlug: string;
}

export function attributeToPublic(attr: AttributeDefinition, lookups: ValueLookups, related: RelatedAttribute | null) {
  const currency = attr.config.currencyConfiguration;
  const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  return {
    id: { workspace_id: attr.workspaceId, object_id: attr.entityDefinitionId, attribute_id: attr.id },
    title: attr.title,
    description: attr.description === '' ? null : attr.description,
    api_slug: attr.apiSlug,
    type: publicType(attr.type),
    is_system_attribute: attr.isSystem,
    is_writable: !(attr.isReadOnly || attr.type === 'interaction' || attr.systemAttributeType === 'id'),
    is_required: attr.isRequired,
    is_unique: attr.isUnique,
    is_multiselect: attr.isMultiselect,
    is_default_value_enabled: attr.defaultValue !== null,
    is_archived: attr.isArchived,
    default_value: defaultValueToPublic(attr, lookups),
    relationship: related
      ? {
          id: {
            workspace_id: related.attribute.workspaceId,
            object_id: related.attribute.entityDefinitionId,
            attribute_id: related.attribute.id,
          },
          object_slug: related.objectSlug,
          title: related.attribute.title,
          api_slug: related.attribute.apiSlug,
          is_multiselect: related.attribute.isMultiselect,
        }
      : null,
    created_at: attioTimestamp(attr.createdAt),
    config: {
      currency: {
        default_currency_code: currency?.defaultCurrencyCode ?? null,
        display_type: currency?.defaultDisplayType ?? null,
      },
      record_reference: { allowed_object_ids: attr.type === 'entity-reference' ? allowed : null },
    },
  };
}

/** Renders attributes with their relationship partners and default-value lookups resolved. */
export async function attributesToPublic(v2: V2Context, attrs: AttributeDefinition[]) {
  const lookups = await loadValueLookups(v2, attrs);
  const out = [];
  for (const attr of attrs) {
    let related: RelatedAttribute | null = null;
    if (attr.relationship) {
      const otherAttrs = await v2.attributesOf(attr.relationship.relatedEntityDefinitionId);
      const other = otherAttrs.find((a) => a.id === attr.relationship?.relatedAttributeDefinitionId);
      const otherDef = await v2.definitionById(attr.relationship.relatedEntityDefinitionId);
      if (other && otherDef) related = { attribute: other, objectSlug: otherDef.apiSlug };
    }
    out.push(attributeToPublic(attr, lookups, related));
  }
  return out;
}
