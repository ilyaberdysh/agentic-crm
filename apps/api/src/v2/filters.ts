// Public filter and sort JSON is parsed into domain predicates and ordering.
// internal predicate AST and sorts (contracts/views.ts, decision X-20; A public-api-mapping §4).
//   shorthand {attr: value} and several keys → $and · verbose {attr: {$op: v}} / {attr: {field: v | {$op: v}}}
//   $and / $or / $not (negation pushed to the leaves: must ↔ must-not, De Morgan on groups)
//   {path: [[object, attribute], …], constraints: {…}} → a multi-hop leaf
import type {
  AttributeDefinition,
  Constraint,
  EntityDefinition,
  Predicate,
  PredicateLeaf,
  Sort,
} from '@agentic-crm/contracts';
import type { V2Context } from './context';
import { publicErrors } from './errors';

type R = Record<string, unknown>;
type Hop = { entityDefinitionId: string; attributeDefinitionId: string };

const isObject = (v: unknown): v is R => typeof v === 'object' && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPERATORS: Record<string, Constraint['operator']> = {
  $eq: 'eq',
  $in: 'in',
  $contains: 'contains',
  $starts_with: 'starts-with',
  $ends_with: 'ends-with',
  $lt: 'lt',
  $lte: 'lte',
  $gt: 'gt',
  $gte: 'gte',
};

/**
 * Public field → internal field per attribute type. `null` = documented but not filterable here (not projected).
 * `default` is the field used by shorthand and operator-only conditions.
 */
const FIELDS: Record<string, { default: string; fields: Record<string, string | null> }> = {
  text: { default: 'value', fields: { value: 'value' } },
  number: { default: 'value', fields: { value: 'value' } },
  rating: { default: 'value', fields: { value: 'value' } },
  checkbox: { default: 'value', fields: { value: 'value' } },
  date: { default: 'value', fields: { value: 'value' } },
  timestamp: { default: 'value', fields: { value: 'value' } },
  currency: { default: 'currency_value', fields: { currency_value: 'raw_value', value: 'raw_value' } },
  pipeline: { default: 'status', fields: { status: 'pipeline_stage_id', active_from: 'active_from' } },
  select: { default: 'option', fields: { option: 'select_option_id' } },
  'entity-reference': {
    default: 'target_record_id',
    fields: { target_record_id: 'target_entity_instance_id', target_object: 'target_object' },
  },
  'actor-reference': {
    default: 'referenced_actor_id',
    fields: { referenced_actor_id: 'referenced_actor_id', referenced_actor_type: 'referenced_actor_type' },
  },
  location: {
    default: 'locality',
    fields: {
      locality: 'locality',
      region: 'region',
      country_code: 'country_code',
      line_1: null,
      line_2: null,
      line_3: null,
      line_4: null,
      postcode: null,
      latitude: null,
      longitude: null,
    },
  },
  domain: { default: 'domain', fields: { domain: 'normalized_domain', root_domain: 'root_domain' } },
  'email-address': {
    default: 'email_address',
    fields: {
      email_address: 'normalized_email_address',
      email_domain: 'email_domain',
      email_root_domain: 'email_root_domain',
      original_email_address: null,
      email_local_specifier: null,
    },
  },
  'phone-number': {
    default: 'phone_number',
    fields: { phone_number: 'normalized_phone_number', country_code: 'country_code', original_phone_number: null },
  },
  'personal-name': {
    default: 'full_name',
    fields: { full_name: 'full_name', first_name: 'first_name', last_name: 'last_name' },
  },
  interaction: {
    default: 'interacted_at',
    fields: { interacted_at: 'interacted_at', owner_member_id: 'owner_membership_id', interaction_type: null },
  },
};

/** Sort fields: public field → internal sort field (undefined = the type's default order). */
const SORT_FIELDS: Record<string, Record<string, string | undefined>> = {
  currency: { currency_value: undefined },
  'personal-name': { full_name: 'full_name', first_name: 'first_name', last_name: 'last_name' },
  'email-address': { email_address: 'normalized_email_address', email_domain: 'email_domain' },
  domain: { domain: 'normalized_domain' },
  'phone-number': { phone_number: 'normalized_phone_number', country_code: 'country_code' },
  location: { locality: 'locality', region: 'region', country_code: 'country_code' },
  interaction: { interacted_at: 'interacted_at' },
};

function negate(p: Predicate): Predicate {
  if ('and' in p) return { or: p.and.map(negate) };
  if ('or' in p) return { and: p.or.map(negate) };
  return { ...p, mode: p.mode === 'must' ? 'must-not' : 'must' };
}

function and(parts: Predicate[]): Predicate {
  return parts.length === 1 ? (parts[0] as Predicate) : { and: parts };
}

function withPrefix(p: Predicate, prefix: Hop[]): Predicate {
  if (prefix.length === 0) return p;
  if ('and' in p) return { and: p.and.map((c) => withPrefix(c, prefix)) };
  if ('or' in p) return { or: p.or.map((c) => withPrefix(c, prefix)) };
  return { ...p, path: [...prefix, ...p.path] };
}

export class FilterTranslator {
  constructor(private readonly v2: V2Context) {}

  async filter(def: EntityDefinition, filter: unknown): Promise<Predicate | null> {
    if (filter === undefined || filter === null) return null;
    if (!isObject(filter)) throw publicErrors.filterError('The filter must be an object.');
    if (Object.keys(filter).length === 0) return null;
    return this.node(def, filter);
  }

  private async node(def: EntityDefinition, node: unknown): Promise<Predicate> {
    if (!isObject(node)) throw publicErrors.filterError('Each filter condition must be an object.');
    const parts: Predicate[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(value)) throw publicErrors.filterError(`${key} expects an array of conditions.`);
        const children = await Promise.all(value.map((c) => this.node(def, c)));
        parts.push(key === '$and' ? { and: children } : { or: children });
      } else if (key === '$not') {
        parts.push(negate(await this.node(def, value)));
      } else if (key === 'path') {
        parts.push(await this.pathCondition(def, value, node.constraints));
      } else if (key === 'constraints') {
        if (!('path' in node)) throw publicErrors.filterError('"constraints" can only be used together with "path".');
      } else if (key.startsWith('$')) {
        throw publicErrors.filterError(`Unknown operator "${key}".`);
      } else {
        const attr = await this.attribute(def, key);
        parts.push(await this.attributeCondition(def, attr, value));
      }
    }
    if (parts.length === 0) return { and: [] };
    return and(parts);
  }

  private async attribute(def: EntityDefinition, key: string): Promise<AttributeDefinition> {
    const attrs = await this.v2.attributesOf(def.id);
    const attr = attrs.find((a) => !a.isHidden && (a.apiSlug === key || a.id === key.toLowerCase()));
    if (!attr) throw publicErrors.filterError(`Unknown attribute "${key}" on object "${def.apiSlug}".`);
    return attr;
  }

  private async pathCondition(def: EntityDefinition, path: unknown, constraints: unknown): Promise<Predicate> {
    if (!Array.isArray(path) || path.length === 0) throw publicErrors.filterError('"path" must be a non-empty array.');
    const hops = await this.resolvePath(def, path);
    const last = hops.at(-1) as { def: EntityDefinition; attr: AttributeDefinition };
    const condition = await this.attributeCondition(last.def, last.attr, constraints ?? {});
    const prefix = hops.slice(0, -1).map((h) => ({ entityDefinitionId: h.def.id, attributeDefinitionId: h.attr.id }));
    return withPrefix(condition, prefix);
  }

  /** `[[object, attribute], …]` → resolved hops; the first tuple must be the queried object. */
  async resolvePath(def: EntityDefinition, path: unknown[]) {
    const hops: { def: EntityDefinition; attr: AttributeDefinition }[] = [];
    let current = def;
    for (const [i, tuple] of path.entries()) {
      if (!Array.isArray(tuple) || tuple.length !== 2 || tuple.some((x) => typeof x !== 'string')) {
        throw publicErrors.filterError('Each path element must be a [object, attribute] pair.');
      }
      const [objectKey, attrKey] = tuple as [string, string];
      const hopDef = (await this.v2.allDefinitions()).find(
        (d) => d.apiSlug === objectKey || d.id === objectKey.toLowerCase(),
      );
      if (!hopDef) throw publicErrors.filterError(`Unknown object "${objectKey}" in path.`);
      if (i === 0 && hopDef.id !== def.id) {
        throw publicErrors.filterError(`The first path element must be the queried object "${def.apiSlug}".`);
      }
      if (i > 0 && hopDef.id !== current.id) {
        const previous = hops[i - 1]?.attr;
        const allowed = previous?.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
        if (allowed && allowed.length > 0 && !allowed.includes(hopDef.id)) {
          throw publicErrors.filterError(`"${previous?.apiSlug}" cannot reference records of "${objectKey}".`);
        }
      }
      const attr = await this.attribute(hopDef, attrKey);
      if (i < path.length - 1 && attr.type !== 'entity-reference') {
        throw publicErrors.filterError(`Only record reference attributes can be traversed in a path ("${attrKey}").`);
      }
      hops.push({ def: hopDef, attr });
      current = hopDef;
    }
    return hops;
  }

  /** The condition object for one attribute (`{attr: <this>}`) → predicate. */
  private async attributeCondition(
    def: EntityDefinition,
    attr: AttributeDefinition,
    value: unknown,
  ): Promise<Predicate> {
    const spec = FIELDS[attr.type] as { default: string; fields: Record<string, string | null> };
    const hop: Hop = { entityDefinitionId: def.id, attributeDefinitionId: attr.id };
    const leaf = (constraints: Constraint[], mode: PredicateLeaf['mode'] = 'must'): PredicateLeaf => ({
      path: [hop],
      mode,
      constraints,
    });
    const constraints: Constraint[] = [];
    const extra: Predicate[] = [];

    const addField = async (publicField: string, condition: unknown) => {
      if (!(publicField in spec.fields)) {
        throw publicErrors.filterError(`Unknown field "${publicField}" for ${attr.type} attribute "${attr.apiSlug}".`);
      }
      const field = spec.fields[publicField];
      if (field === null || field === undefined) {
        throw publicErrors.filterError(`Filtering on "${attr.apiSlug}.${publicField}" is not supported.`);
      }
      const ops: [string, unknown][] =
        isObject(condition) && Object.keys(condition).every((k) => k.startsWith('$'))
          ? Object.entries(condition)
          : [['$eq', condition]];
      for (const [op, operand] of ops) {
        if (op === '$not_empty') {
          if (typeof operand !== 'boolean') throw publicErrors.filterError('$not_empty expects true or false.');
          constraints.push({ field, operator: operand ? 'not-empty' : 'empty' });
          continue;
        }
        const operator = OPERATORS[op];
        if (!operator) throw publicErrors.filterError(`Unknown operator "${op}".`);
        await this.addConstraint(attr, field, operator, operand, constraints, extra, leaf);
      }
    };

    if (!isObject(value)) {
      await addField(spec.default, value);
    } else {
      const operatorKeys = Object.keys(value).filter((k) => k.startsWith('$'));
      if (operatorKeys.length > 0) {
        await addField(spec.default, Object.fromEntries(operatorKeys.map((k) => [k, value[k]])));
      }
      for (const [field, condition] of Object.entries(value)) {
        if (!field.startsWith('$')) await addField(field, condition);
      }
    }
    // record_id has no projection column: the compiler maps the system id attribute to the instance id.
    if (attr.systemAttributeType === 'id') {
      for (const c of constraints) c.field = 'value';
    }
    const parts: Predicate[] = [];
    if (constraints.length > 0 || extra.length === 0) parts.push(leaf(constraints));
    parts.push(...extra);
    return and(parts);
  }

  private async addConstraint(
    attr: AttributeDefinition,
    field: string,
    operator: Constraint['operator'],
    operand: unknown,
    constraints: Constraint[],
    extra: Predicate[],
    leaf: (constraints: Constraint[]) => PredicateLeaf,
  ): Promise<void> {
    if (operand === undefined) throw publicErrors.filterError(`Missing value for "${attr.apiSlug}".`);
    switch (field) {
      case 'pipeline_stage_id':
      case 'select_option_id': {
        const resolve = async (key: unknown) => this.optionId(attr, key);
        const value =
          operator === 'in' && Array.isArray(operand)
            ? await Promise.all(operand.map(resolve))
            : await resolve(operand);
        constraints.push({ field, operator, value });
        return;
      }
      case 'target_object':
        // Record ids are unique across objects: the object constraint only narrows when no record id is given.
        if (typeof operand !== 'string') throw publicErrors.filterError('target_object expects an object slug or ID.');
        return;
      case 'referenced_actor_type':
        if (operand !== 'workspace-member') {
          throw publicErrors.filterError('Only workspace-member actor references can be filtered.');
        }
        if (!constraints.some((c) => c.field === 'referenced_actor_id')) {
          constraints.push({ field: 'referenced_actor_id', operator: 'not-empty' });
        }
        return;
      case 'referenced_actor_id': {
        let value = operand;
        if (typeof operand === 'string' && operand.includes('@')) {
          const member = (await this.v2.workspaceMembers()).find(
            (m) => m.emailAddress.toLowerCase() === operand.toLowerCase(),
          );
          value = member?.id ?? '00000000-0000-0000-0000-000000000000';
        }
        const i = constraints.findIndex((c) => c.field === 'referenced_actor_id' && c.operator === 'not-empty');
        if (i >= 0) constraints.splice(i, 1);
        constraints.push({ field, operator, value });
        return;
      }
      case 'root_domain':
      case 'email_root_domain': {
        // Not projected: "root domain = X" ⇔ the domain is X or a subdomain of X.
        if (operator !== 'eq' || typeof operand !== 'string') {
          throw publicErrors.filterError(`Only $eq is supported on "${attr.apiSlug}.${field}".`);
        }
        const base = field === 'root_domain' ? 'normalized_domain' : 'email_domain';
        extra.push({
          or: [
            leaf([{ field: base, operator: 'eq', value: operand }]),
            leaf([{ field: base, operator: 'ends-with', value: `.${operand}` }]),
          ],
        });
        return;
      }
      default:
        constraints.push({ field, operator, value: operand });
    }
  }

  private async optionId(attr: AttributeDefinition, key: unknown): Promise<string> {
    if (typeof key !== 'string')
      throw publicErrors.filterError(`Expected an option title or ID for "${attr.apiSlug}".`);
    const options = await this.v2.optionsOf(attr);
    const match =
      options.find((o) => o.id === key.toLowerCase()) ??
      options.find((o) => o.title === key) ??
      options.find((o) => o.title.toLowerCase() === key.toLowerCase());
    if (!match) {
      const kind = attr.type === 'pipeline' ? 'status' : 'select option';
      throw publicErrors.filterError(`Unknown ${kind} "${key}" for attribute "${attr.apiSlug}".`);
    }
    return match.id;
  }

  /** `sorts` → internal sorts (only direct attributes; paths through references are not supported yet). */
  async sorts(def: EntityDefinition, sorts: unknown): Promise<Sort[]> {
    if (sorts === undefined || sorts === null) return [];
    if (!Array.isArray(sorts)) throw publicErrors.filterError('"sorts" must be an array.');
    const out: Sort[] = [];
    for (const s of sorts) {
      if (!isObject(s) || (s.direction !== 'asc' && s.direction !== 'desc')) {
        throw publicErrors.filterError('Each sort needs a direction of "asc" or "desc".');
      }
      let attr: AttributeDefinition;
      let hopDef = def;
      if (typeof s.attribute === 'string') {
        attr = await this.attribute(def, s.attribute);
      } else if (Array.isArray(s.path)) {
        const hops = await this.resolvePath(def, s.path);
        if (hops.length > 1) throw publicErrors.filterError('Sorting through record references is not supported yet.');
        attr = (hops[0] as { attr: AttributeDefinition }).attr;
        hopDef = (hops[0] as { def: EntityDefinition }).def;
      } else {
        throw publicErrors.filterError('Each sort needs an "attribute" or a "path".');
      }
      let field: string | undefined;
      if (typeof s.field === 'string') {
        const map = SORT_FIELDS[attr.type];
        if (s.field === 'value' || !map) field = s.field === 'value' ? undefined : s.field;
        else if (s.field in map) field = map[s.field];
        else throw publicErrors.filterError(`Cannot sort "${attr.apiSlug}" by "${s.field}".`);
      }
      out.push({
        path: [{ entityDefinitionId: hopDef.id, attributeDefinitionId: attr.id }],
        direction: s.direction,
        ...(field ? { field } : {}),
      });
    }
    return out;
  }
}

export { UUID as UUID_PATTERN };
