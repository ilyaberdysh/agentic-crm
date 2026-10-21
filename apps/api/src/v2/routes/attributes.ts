// Attributes, select options and statuses of objects (A public-api-mapping §3 #19–28; data-model-documented §2.1–2.2,
// §2.6). `/v2/{target}/{identifier}/…` is registered for target `objects` and `lists` (a list's attributes live on its
// collection-entry definition; scopes list_configuration:*).
import type {
  AttributeDefinition,
  CreateAttributeInput,
  DefaultValue,
  EntityDefinition,
  UpdateAttributeInput,
} from '@agentic-crm/contracts';
import {
  createAttributeBody,
  createSelectOptionBody,
  createStatusBody,
  listAttributesQuery,
  listSelectOptionsQuery,
  listStatusesQuery,
  updateAttributeBody,
  updateSelectOptionBody,
  updateStatusBody,
} from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import type { V2Context } from '../context';
import { publicErrors, withHints } from '../errors';
import { attributesToPublic, internalType, selectOptionToPublic, statusToPublic } from '../mappers';
import { page, params, parseInput, type RouteSpec } from '../route';
import { toInternalValue } from '../values';

type Target = 'objects' | 'lists';

const scopes = (target: Target, level: 'read' | 'read-write') => [
  `${target === 'lists' ? 'list_configuration' : 'object_configuration'}:${level}`,
];

const identifierOf = (p: Record<string, string>) => p.object ?? p.list ?? '';

async function targetDefinition(v2: V2Context, target: Target, identifier: string): Promise<EntityDefinition> {
  return target === 'lists' ? v2.list(identifier) : v2.object(identifier);
}

const NOT_CREATABLE = new Set(['interaction', 'personal-name', 'domain', 'email-address']);
const NO_DEFAULTS = new Set(['person-record', 'company-record']);

async function resolveObjectIds(v2: V2Context, keys: string[]): Promise<string[]> {
  const defs = await v2.allDefinitions();
  return keys.map((key) => {
    const def = defs.find((d) => d.apiSlug === key || d.id === key.toLowerCase());
    if (!def) throw publicErrors.validation(`Could not find an object with slug "${key}".`);
    return def.id;
  });
}

type PublicDefault = { type: 'dynamic'; template: string } | { type: 'static'; template: unknown[] } | null;

/** Public default value → internal (dynamic template kept; static template values converted to write forms). */
async function toInternalDefault(
  v2: V2Context,
  attr: Pick<AttributeDefinition, 'id' | 'type' | 'apiSlug' | 'config' | 'entityDefinitionId'>,
  value: PublicDefault | undefined,
  canResolveOptions: boolean,
): Promise<DefaultValue | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value.type === 'dynamic') return { type: 'dynamic', identifier: value.template };
  if ((attr.type === 'select' || attr.type === 'pipeline') && !canResolveOptions) {
    throw publicErrors.validation(
      'Static default values of select and status attributes can be set once the attribute has options.',
    );
  }
  const items: unknown[] = [];
  for (const item of value.template) items.push(await toInternalValue(v2, attr as AttributeDefinition, item));
  return { type: 'static', identifier: JSON.stringify(items) };
}

function currencyConfig(code: string | undefined, display: string | undefined, current?: AttributeDefinition) {
  const existing = current?.config.currencyConfiguration;
  return {
    ...(existing ?? {}),
    defaultCurrencyCode: (code ?? existing?.defaultCurrencyCode ?? 'USD') as never,
    defaultDisplayType: (display ?? existing?.defaultDisplayType ?? 'symbol') as never,
  };
}

function attributeRoutes(target: Target): RouteSpec[] {
  const base = target === 'objects' ? '/objects/:object/attributes' : '/lists/:list/attributes';
  return [
    {
      method: 'GET',
      url: base,
      operationId: 'listAttributes',
      scopes: scopes(target, 'read'),
      async handler(v2, request) {
        const query = parseInput(listAttributesQuery, request.query, 'query parameters');
        const def = await targetDefinition(v2, target, identifierOf(params(request)));
        const attrs = (await v2.attributesOf(def.id)).filter(
          (a) => !a.isHidden && (query.show_archived || !a.isArchived),
        );
        return { data: await attributesToPublic(v2, page(attrs, query)) };
      },
    },
    {
      method: 'GET',
      url: `${base}/:attribute`,
      operationId: 'getAttribute',
      scopes: scopes(target, 'read'),
      async handler(v2, request) {
        const p = params(request);
        const def = await targetDefinition(v2, target, identifierOf(p));
        const attr = await v2.attribute(def, p.attribute ?? '');
        return { data: (await attributesToPublic(v2, [attr]))[0] };
      },
    },
    {
      method: 'POST',
      url: base,
      operationId: 'createAttribute',
      scopes: scopes(target, 'read-write'),
      async handler(v2, request) {
        const { data: d } = parseInput(createAttributeBody, request.body, 'request body');
        const def = await targetDefinition(v2, target, identifierOf(params(request)));
        const type = internalType(d.type);
        if (!type) throw publicErrors.validation(`"${d.type}" is not a valid attribute type.`);
        if (NOT_CREATABLE.has(type)) throw publicErrors.validation(`Attributes of type "${d.type}" cannot be created.`);
        if (d.default_value && NO_DEFAULTS.has(def.entityType)) {
          throw publicErrors.validation('Default values are not supported on people or company objects.');
        }
        const input: CreateAttributeInput = {
          id: newId(),
          entityDefinitionId: def.id,
          title: d.title,
          description: d.description ?? '',
          type,
          apiSlug: d.api_slug,
          isMultiselect: d.is_multiselect,
          isUnique: d.is_unique,
          isRequired: d.is_required,
        };
        if (type === 'currency') {
          input.currencyConfiguration = currencyConfig(
            d.config.currency?.default_currency_code,
            d.config.currency?.display_type,
          );
        }
        const allowed = d.config.record_reference
          ? await resolveObjectIds(v2, d.config.record_reference.allowed_objects)
          : null;
        if (d.relationship) {
          if (type !== 'entity-reference') {
            throw publicErrors.validation('Relationships can only be created on record-reference attributes.');
          }
          const [relatedId] = await resolveObjectIds(v2, [d.relationship.object]);
          if (allowed && (allowed.length !== 1 || allowed[0] !== relatedId)) {
            throw publicErrors.validation(
              'config.record_reference.allowed_objects must only contain the relationship object.',
            );
          }
          input.relationship = {
            id: newId(),
            entityDefinitionId: relatedId as string,
            title: d.relationship.title,
            apiSlug: d.relationship.api_slug,
            isMultiselect: d.relationship.is_multiselect,
          };
        } else if (type === 'entity-reference') {
          input.entityReferenceConfiguration = {
            allowedEntityDefinitionIds: allowed && allowed.length > 0 ? allowed : null,
          };
        }
        const defaultValue = await toInternalDefault(
          v2,
          { id: '', type, apiSlug: d.api_slug, config: {}, entityDefinitionId: def.id },
          d.default_value as PublicDefault | undefined,
          false,
        );
        if (defaultValue !== undefined) input.defaultValue = defaultValue;
        const created = await withHints({ object: def.apiSlug, attribute: d.api_slug }, () =>
          v2.domain.schema.createAttribute(v2.ctx, input),
        );
        v2.invalidate();
        return { data: (await attributesToPublic(v2, [created]))[0] };
      },
    },
    {
      method: 'PATCH',
      url: `${base}/:attribute`,
      operationId: 'updateAttribute',
      scopes: scopes(target, 'read-write'),
      async handler(v2, request) {
        const p = params(request);
        const { data: d } = parseInput(updateAttributeBody, request.body, 'request body');
        const def = await targetDefinition(v2, target, identifierOf(p));
        const attr = await v2.attribute(def, p.attribute ?? '');
        if (attr.isSystem) throw publicErrors.systemEdit('Cannot update a System attribute.');
        if (Object.values(d).every((v) => v === undefined)) {
          throw publicErrors.validation(
            'You passed an empty payload. Please ensure you are updating at least one property in your request.',
          );
        }
        if (d.default_value && NO_DEFAULTS.has(def.entityType)) {
          throw publicErrors.validation('Default values are not supported on people or company objects.');
        }
        const input: UpdateAttributeInput = { entityDefinitionId: def.id, attributeDefinitionId: attr.id };
        if (d.title !== undefined) input.title = d.title;
        if (d.description !== undefined) input.description = d.description ?? '';
        if (d.api_slug !== undefined) input.apiSlug = d.api_slug;
        if (d.is_required !== undefined) input.isRequired = d.is_required;
        if (d.is_unique !== undefined) input.isUnique = d.is_unique;
        if (d.is_archived !== undefined) input.isArchived = d.is_archived;
        if (d.config?.currency && attr.type === 'currency') {
          input.currencyConfiguration = currencyConfig(
            d.config.currency.default_currency_code,
            d.config.currency.display_type,
            attr,
          );
        }
        if (d.config?.record_reference && attr.type === 'entity-reference') {
          input.entityReferenceConfiguration = {
            allowedEntityDefinitionIds: await resolveObjectIds(v2, d.config.record_reference.allowed_objects),
          };
        }
        const defaultValue = await toInternalDefault(v2, attr, d.default_value as PublicDefault | undefined, true);
        if (defaultValue !== undefined) input.defaultValue = defaultValue;
        const updated = await withHints({ object: def.apiSlug, attribute: p.attribute ?? '' }, () =>
          v2.domain.schema.updateAttribute(v2.ctx, input),
        );
        v2.invalidate();
        return { data: (await attributesToPublic(v2, [updated]))[0] };
      },
    },
  ];
}

/** Options (`select`) and statuses (`status`) share their routes' shape. */
function optionRoutes(target: Target, kind: 'options' | 'statuses'): RouteSpec[] {
  const base = `${target === 'objects' ? '/objects/:object' : '/lists/:list'}/attributes/:attribute/${kind}`;
  const isStatus = kind === 'statuses';
  const wanted = isStatus ? 'pipeline' : 'select';
  const notThatKind = isStatus
    ? 'This attribute is not a status attribute.'
    : 'This attribute is not a select attribute.';
  const hints = (title?: string) => ({
    optionKind: isStatus ? ('status' as const) : ('select option' as const),
    optionTitle: title,
  });

  const resolveAttr = async (v2: V2Context, p: Record<string, string>) => {
    const def = await targetDefinition(v2, target, identifierOf(p));
    const attr = await v2.attribute(def, p.attribute ?? '');
    if (attr.type !== wanted) throw publicErrors.validation(notThatKind);
    return attr;
  };
  const render = (o: Awaited<ReturnType<V2Context['optionsOf']>>[number]) =>
    isStatus ? statusToPublic(o as Parameters<typeof statusToPublic>[0]) : selectOptionToPublic(o);

  return [
    {
      method: 'GET',
      url: base,
      operationId: isStatus ? 'listStatuses' : 'listSelectOptions',
      scopes: scopes(target, 'read'),
      async handler(v2, request) {
        const query = parseInput(
          isStatus ? listStatusesQuery : listSelectOptionsQuery,
          request.query,
          'query parameters',
        );
        const attr = await resolveAttr(v2, params(request));
        const options = (await v2.optionsOf(attr)).filter((o) => query.show_archived || !o.isArchived);
        return { data: options.map(render) };
      },
    },
    {
      method: 'POST',
      url: base,
      operationId: isStatus ? 'createStatus' : 'createSelectOption',
      scopes: scopes(target, 'read-write'),
      async handler(v2, request) {
        const attr = await resolveAttr(v2, params(request));
        const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id, id: newId() };
        if (isStatus) {
          const { data } = parseInput(createStatusBody, request.body, 'request body');
          const stage = await withHints(hints(data.title), () =>
            v2.domain.schema.createStage(v2.ctx, {
              ...ref,
              title: data.title,
              celebrationEnabled: data.celebration_enabled ?? false,
              ...(data.target_time_in_status !== undefined ? { targetTimeInStatus: data.target_time_in_status } : {}),
            }),
          );
          return { data: statusToPublic(stage) };
        }
        const { data } = parseInput(createSelectOptionBody, request.body, 'request body');
        const option = await withHints(hints(data.title), () =>
          v2.domain.schema.createOption(v2.ctx, { ...ref, title: data.title }),
        );
        return { data: selectOptionToPublic(option) };
      },
    },
    {
      method: 'PATCH',
      url: `${base}/:option`,
      operationId: isStatus ? 'updateStatus' : 'updateSelectOption',
      scopes: scopes(target, 'read-write'),
      async handler(v2, request) {
        const p = params(request);
        const attr = await resolveAttr(v2, p);
        const key = p.option ?? '';
        const options = await v2.optionsOf(attr);
        const current =
          options.find((o) => o.id === key.toLowerCase()) ??
          options.find((o) => o.title === key && !o.isArchived) ??
          options.find((o) => o.title === key);
        if (!current) {
          throw publicErrors.valueNotFound(
            isStatus
              ? `Cannot find status attribute with status option title "${key}".`
              : `Cannot find select attribute with select option title "${key}".`,
          );
        }
        const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
        if (isStatus) {
          const { data } = parseInput(updateStatusBody, request.body, 'request body');
          const stage = await withHints(hints(data.title), () =>
            v2.domain.schema.updateStage(v2.ctx, {
              ...ref,
              pipelineStageId: current.id,
              ...(data.title !== undefined ? { title: data.title } : {}),
              ...(data.celebration_enabled !== undefined ? { celebrationEnabled: data.celebration_enabled } : {}),
              ...(data.target_time_in_status !== undefined ? { targetTimeInStatus: data.target_time_in_status } : {}),
              ...(data.is_archived !== undefined ? { isArchived: data.is_archived } : {}),
            }),
          );
          return { data: statusToPublic(stage) };
        }
        const { data } = parseInput(updateSelectOptionBody, request.body, 'request body');
        const option = await withHints(hints(data.title), () =>
          v2.domain.schema.updateOption(v2.ctx, {
            ...ref,
            selectOptionId: current.id,
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.is_archived !== undefined ? { isArchived: data.is_archived } : {}),
          }),
        );
        return { data: selectOptionToPublic(option) };
      },
    },
  ];
}

export const attributeRoutesAll: RouteSpec[] = (['objects', 'lists'] as const).flatMap((target) => [
  ...attributeRoutes(target),
  ...optionRoutes(target, 'options'),
  ...optionRoutes(target, 'statuses'),
]);
