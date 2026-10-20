// Objects: list, get, create, update (A public-api-mapping §3 #1–4; data-model-documented §1.3).

import { createObjectBody, updateObjectBody, v2Operations } from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import { PUBLIC_OBJECT_TYPES } from '../context';
import { publicErrors, toPublicError, withHints } from '../errors';
import { objectToPublic } from '../mappers';
import { params, parseInput, type RouteSpec } from '../route';

export const objectRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/objects',
    scopes: v2Operations.listObjects.scopes,
    async handler(v2) {
      const defs = await v2.allDefinitions();
      const readable = await v2.readable();
      return {
        data: defs
          .filter((d) => PUBLIC_OBJECT_TYPES.has(d.entityType) && (readable === null || readable.has(d.id)))
          .map(objectToPublic),
      };
    },
  },
  {
    method: 'GET',
    url: '/objects/:object',
    scopes: v2Operations.getObject.scopes,
    async handler(v2, request) {
      return { data: objectToPublic(await v2.object(params(request).object ?? '')) };
    },
  },
  {
    method: 'POST',
    url: '/objects',
    scopes: v2Operations.createObject.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createObjectBody, request.body, 'request body');
      // Creating objects is an admin action (settings → Objects); user-level tokens act as their member.
      if (v2.ctx.onBehalfOfMemberId) {
        const member = await withHints({}, () => v2.domain.members.get(v2.ctx, v2.ctx.onBehalfOfMemberId as string));
        if (member.accessLevel !== 'admin') {
          throw publicErrors.forbidden(
            'You do not have the necessary permissions to create objects in this workspace.',
          );
        }
      }
      const created = await withHints({}, () =>
        v2.domain.schema.createObject(v2.ctx, {
          id: newId(),
          apiSlug: data.api_slug,
          singularNoun: data.singular_noun,
          pluralNoun: data.plural_noun,
        }),
      );
      return { data: objectToPublic(created) };
    },
  },
  {
    method: 'PATCH',
    url: '/objects/:object',
    scopes: v2Operations.updateObject.scopes,
    async handler(v2, request) {
      const key = params(request).object ?? '';
      const { data } = parseInput(updateObjectBody, request.body, 'request body');
      const def = await v2.object(key);
      if (data.api_slug === undefined && data.singular_noun === undefined && data.plural_noun === undefined) {
        throw publicErrors.validation(
          'You passed an empty payload. Please ensure you are updating at least one property in your request.',
        );
      }
      try {
        const updated = await v2.domain.schema.updateObject(v2.ctx, {
          entityDefinitionId: def.id,
          ...(data.api_slug !== undefined ? { apiSlug: data.api_slug } : {}),
          ...(data.singular_noun !== undefined ? { singularNoun: data.singular_noun } : {}),
          ...(data.plural_noun !== undefined ? { pluralNoun: data.plural_noun } : {}),
        });
        return { data: objectToPublic(updated) };
      } catch (err) {
        if ((err as { code?: string }).code === 'SLUG_IN_USE') {
          throw publicErrors.slugConflict('Failed to update object. Please ensure api_slug is unique.');
        }
        if ((err as { code?: string }).code === 'RESERVED_API_SLUG') {
          throw publicErrors.systemEdit('The api_slug of a standard object cannot be changed.');
        }
        throw toPublicError(err, { object: key });
      }
    },
  },
];
