// Public REST error envelope:
//   {"status_code": 404, "type": "invalid_request_error", "code": "not_found", "message": "…"}
// Domain errors (packages/domain DomainError with an internal code) are translated here, with endpoint-specific messages where
// the spec documents one.
import { DomainError } from '@agentic-crm/domain';

export type PublicErrorType = 'invalid_request_error' | 'auth_error' | 'rate_limit_error' | 'api_error';

export interface PublicErrorBody {
  status_code: number;
  type: PublicErrorType;
  code: string;
  message: string;
}

export class PublicApiError extends Error {
  readonly statusCode: number;
  readonly type: PublicErrorType;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(
    statusCode: number,
    type: PublicErrorType,
    code: string,
    message: string,
    options: { cause?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PublicApiError';
    this.statusCode = statusCode;
    this.type = type;
    this.code = code;
    this.headers = options.headers ?? {};
  }

  toBody(): PublicErrorBody {
    return { status_code: this.statusCode, type: this.type, code: this.code, message: this.message };
  }
}

const invalid = (status: number, code: string, message: string, cause?: unknown) =>
  new PublicApiError(status, 'invalid_request_error', code, message, { cause });

export const publicErrors = {
  notFound: (message: string) => invalid(404, 'not_found', message),
  objectNotFound: (slugOrId: string) => invalid(404, 'not_found', `Object with slug/ID "${slugOrId}" not found.`),
  listNotFound: (slugOrId: string) => invalid(404, 'not_found', `List with slug/ID "${slugOrId}" not found.`),
  attributeNotFound: (slugOrId: string) => invalid(404, 'not_found', `Attribute with slug/ID "${slugOrId}" not found.`),
  recordNotFound: (id: string) => invalid(404, 'not_found', `Record with ID "${id}" not found.`),
  memberNotFound: (id: string) => invalid(404, 'not_found', `Workspace member with ID "${id}" not found.`),
  validation: (message: string, cause?: unknown) => invalid(400, 'validation_type', message, cause),
  valueNotFound: (message: string) => invalid(400, 'value_not_found', message),
  missingValue: (message: string) => invalid(400, 'missing_value', message),
  filterError: (message: string) => invalid(400, 'filter_error', message),
  slugConflict: (message: string) => invalid(409, 'slug_conflict', message),
  uniquenessConflict: (message: string) => invalid(409, 'uniqueness_conflict', message),
  systemEdit: (message: string) => invalid(400, 'system_edit_unauthorized', message),
  standardObjectDisabled: (slug: string) =>
    invalid(400, 'standard_object_disabled', `The standard object "${slug}" is not enabled in this workspace.`),
  unauthenticated: (message: string) =>
    new PublicApiError(401, 'auth_error', 'unauthorized', message, { headers: { 'www-authenticate': 'Bearer' } }),
  forbidden: (message: string) => new PublicApiError(403, 'auth_error', 'unauthorized', message),
  rateLimited: (retryAt: Date) =>
    new PublicApiError(429, 'rate_limit_error', 'rate_limit_exceeded', 'Rate limit exceeded, please try again later.', {
      headers: { 'retry-after': retryAt.toUTCString() },
    }),
};

function isZodLike(err: unknown): err is { issues: { path: PropertyKey[]; message: string }[] } {
  const name = (err as { name?: unknown } | null)?.name;
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as { issues?: unknown }).issues) &&
    (name === 'ZodError' || name === '$ZodError')
  );
}

/** "data.api_slug: Invalid input" — the first issue, with its path. */
export function describeZodError(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = err.issues[0];
  if (!issue) return 'The request is invalid.';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** What the failing call was about, so 404s and conflicts can use the public API's messages. */
export interface ErrorHints {
  object?: string;
  attribute?: string;
  recordId?: string;
  optionKind?: 'select option' | 'status';
  optionTitle?: string;
}

function fromDomainError(err: DomainError, hints: ErrorHints): PublicApiError {
  const d = err.details as Record<string, unknown>;
  switch (err.code) {
    case 'NOT_FOUND':
    case 'BASE_ENTITY_INSTANCE_NOT_FOUND':
    case 'TARGET_ENTITY_INSTANCE_NOT_FOUND': {
      if (d.entity_instance_id !== undefined) return publicErrors.recordNotFound(String(d.entity_instance_id));
      if (d.attribute_definition_id !== undefined)
        return publicErrors.attributeNotFound(hints.attribute ?? String(d.attribute_definition_id));
      if (d.entity_definition_id !== undefined)
        return publicErrors.objectNotFound(hints.object ?? String(d.entity_definition_id));
      if (d.workspace_member_id !== undefined) return publicErrors.memberNotFound(String(d.workspace_member_id));
      if (d.entity_view_id !== undefined)
        return publicErrors.notFound(`View with ID "${String(d.entity_view_id)}" not found.`);
      return publicErrors.notFound(err.message);
    }
    case 'UNIQUE_CONSTRAINT_VIOLATION':
      return publicErrors.uniquenessConflict(
        `Uniqueness constraint violated: ${err.message}${
          Array.isArray(d.entity_instance_ids) ? ` (conflicting record IDs: ${d.entity_instance_ids.join(', ')})` : ''
        }.`,
      );
    case 'SLUG_IN_USE':
      return publicErrors.slugConflict(
        hints.attribute !== undefined
          ? 'An attribute with the same API slug already exists on this object. Please choose a different API slug.'
          : 'Failed to create object. Please ensure your api_slug and names are unique.',
      );
    case 'TITLE_IN_USE':
      return publicErrors.slugConflict(
        `There is already another ${hints.optionKind ?? 'select option'} with the title "${String(d.title ?? hints.optionTitle ?? '')}".`,
      );
    case 'RESERVED_API_SLUG':
    case 'ATTRIBUTE_READ_ONLY':
      return publicErrors.systemEdit(err.message);
    case 'DUPLICATE_VALUE_IN_MULTISELECT':
      return invalid(400, 'duplicate_values', err.message);
    case 'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED':
      return invalid(400, 'limit_reached', err.message);
    case 'UNSUPPORTED_FILTER':
    case 'UNSUPPORTED_SORT':
      return publicErrors.filterError(err.message);
    case 'VALUE_VALIDATION_FAILED': {
      const reason = String(d.reason ?? '');
      if (reason === 'required') {
        return publicErrors.missingValue(
          `Required value for attribute with ID "${String(d.attribute_definition_id)}" was not provided.`,
        );
      }
      if (reason === 'single-value') return invalid(400, 'multiple_values_for_single_value_attribute', err.message);
      if (reason.startsWith('unknown-') || reason.startsWith('archived-'))
        return publicErrors.valueNotFound(err.message);
      return publicErrors.validation(err.message);
    }
    case 'FORBIDDEN':
      return publicErrors.forbidden(permissionMessage(d, hints) ?? err.message);
    case 'PARTICLE_GATE_VIOLATION':
      return invalid(422, 'particle_gate_violation', err.message);
    case 'SUBSCRIPTION_CONFLICT':
      return publicErrors.uniquenessConflict(err.message);
    case 'INSTANCE_ID_CONFLICT':
    case 'ID_CONFLICT':
      return invalid(409, 'concurrent_write_conflict', err.message);
    default:
      if (err.statusCode === 404) return publicErrors.notFound(err.message);
      if (err.statusCode === 409) return invalid(409, 'uniqueness_conflict', err.message);
      if (err.statusCode === 403) return publicErrors.forbidden(err.message);
      if (err.statusCode < 500) return publicErrors.validation(err.message);
      return new PublicApiError(500, 'api_error', 'internal_error', 'An unexpected error occurred.', {
        cause: err,
      });
  }
}

/** What a denied action was about, in the public API's 403 wording per endpoint (api.json 403 examples). */
const DENIED: Record<string, { object: string; list: string }> = {
  create_entity_instance: { object: 'create this record', list: 'create entries in this list' },
  update_entity_instance: { object: 'update this record', list: 'update entries in this list' },
  create_attribute_value: { object: 'update this record', list: 'update entries in this list' },
  update_attribute_value: { object: 'update this record', list: 'update entries in this list' },
  delete_entity_instance: { object: 'delete this record', list: 'delete entries in this list' },
  batch_delete_entity_instances: { object: 'delete this record', list: 'delete entries in this list' },
  read_entity_instance: { object: 'read records of this object', list: 'read entries in this list' },
  read_attribute_value: { object: 'read records of this object', list: 'read entries in this list' },
  read_entity_definition: { object: 'read this object', list: 'read this list' },
  update_entity_definition: { object: 'update this object', list: 'update this list' },
  delete_entity_definition: { object: 'delete this object', list: 'delete this list' },
  create_attribute_definition: { object: 'create this attribute', list: 'create this attribute' },
  update_attribute_definition: { object: 'update this attribute', list: 'update this attribute' },
  archive_attribute_definition: { object: 'update this attribute', list: 'update this attribute' },
};

function permissionMessage(d: Record<string, unknown>, hints: ErrorHints): string | null {
  const action = typeof d.action === 'string' ? d.action : null;
  if (!action) return null;
  if (hints.optionKind && action === 'update_attribute_definition') {
    return `You do not have the necessary permissions to update this ${hints.optionKind}.`;
  }
  const phrase = DENIED[action];
  if (!phrase) return null;
  return `You do not have the necessary permissions to ${d.entity_type === 'collection-entry' ? phrase.list : phrase.object}.`;
}

/** Anything thrown while serving a /v2 request → a PublicApiError. */
export function toPublicError(err: unknown, hints: ErrorHints = {}): PublicApiError {
  if (err instanceof PublicApiError) return err;
  if (err instanceof DomainError) return fromDomainError(err, hints);
  if (isZodLike(err)) return publicErrors.validation(describeZodError(err), err);
  const fastify = err as { statusCode?: unknown; code?: unknown; message?: unknown } | null;
  if (fastify && typeof fastify.statusCode === 'number' && fastify.statusCode >= 400 && fastify.statusCode < 500) {
    if (fastify.statusCode === 413) return invalid(413, 'validation_type', 'The request body is too large.');
    if (fastify.statusCode === 415) return publicErrors.validation('Requests must use Content-Type: application/json.');
    return publicErrors.validation(
      typeof fastify.message === 'string' && fastify.message ? fastify.message : 'The request is invalid.',
    );
  }
  return new PublicApiError(500, 'api_error', 'internal_error', 'An unexpected error occurred.', {
    cause: err,
  });
}

/** Runs a domain call and translates its errors with hints. */
export async function withHints<T>(hints: ErrorHints, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toPublicError(err, hints);
  }
}
