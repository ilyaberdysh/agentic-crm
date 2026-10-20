// Attio-style error envelope (J README §5, A internal-api-shapes §1.2):
//   {"statusCode":409,"error":"Conflict","message":"…","status_code":409,"additional_information":{"code":…}}
// Domain errors carry a stable `code` in additional_information plus code-specific keys
// (entity_instance_ids for unique conflicts, conflicting_field for slugs, …).
import { z } from 'zod';

export const errorCodes = [
  'VALIDATION_ERROR',
  'VALUE_VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNIQUE_CONSTRAINT_VIOLATION',
  'DUPLICATE_VALUE_IN_MULTISELECT',
  'SLUG_IN_USE',
  'RESERVED_SLUG',
  'RESERVED_API_SLUG',
  'TITLE_IN_USE',
  'INSTANCE_ID_CONFLICT',
  'ID_CONFLICT',
  'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED',
  /** A workspace quota was reached (attributes per object, views per object, …); additional_information.quota. */
  'OVER_USAGE_LIMIT',
  'ATTRIBUTE_READ_ONLY',
  'ATTRIBUTE_ARCHIVED',
  'SELF_MERGE',
  'MERGING_NOT_SUPPORTED_FOR_ENTITY_TYPE',
  'BASE_ENTITY_INSTANCE_NOT_FOUND',
  'TARGET_ENTITY_INSTANCE_NOT_FOUND',
  'SNAPSHOT_NOT_FOUND',
  'UNSUPPORTED_FILTER',
  'UNSUPPORTED_SORT',
  'ALREADY_A_MEMBER',
  'INVITE_ALREADY_EXISTS',
  'INVITE_NOT_FOUND',
  'LAST_ADMIN',
  'NOT_A_MEMBER',
  /** A file or folder with this name already exists in the folder (D §3.9). */
  'NAME_IN_USE',
  /** A save based on an outdated version (record page layout editor). */
  'VERSION_CONFLICT',
  /** complete() before the bytes were uploaded, or with a different size. */
  'UPLOAD_INCOMPLETE',
  /** Object storage (S3) could not be reached. */
  'STORAGE_UNAVAILABLE',
  /** The import is not in a state that allows this (e.g. mapping a running import, deleting an executed one). */
  'IMPORT_STATE_CONFLICT',
  /** The export has not completed (download before `complete`). */
  'EXPORT_NOT_READY',
  /** Background jobs (pg-boss) are not configured for this process. */
  'JOBS_UNAVAILABLE',
  /**
   * A member write left a record violating a requirement rule (422; additional_information.violated_validation_rules,
   * A §4.13). The transaction is rolled back; the client parks the write.
   */
  'PARTICLE_GATE_VIOLATION',
  /** Webhook subscriptions must have a unique (target URL, event type, filter) within the workspace (409). */
  'SUBSCRIPTION_CONFLICT',
  // Slice 7 (email and calendar).
  /** The address is already connected as a mailbox of the workspace. */
  'MAILBOX_ALREADY_CONNECTED',
  /** No connector for the provider (Gmail arrives with 7b), or the mailbox cannot send / sync. */
  'PROVIDER_NOT_SUPPORTED',
  /** 7b: the provider's OAuth client is not configured on this server (400; e.g. GOOGLE_CLIENT_ID unset). */
  'PROVIDER_NOT_CONFIGURED',
  /** 7b: "Reconnect" signed in to a different account than the mailbox's address (409). */
  'MAILBOX_ACCOUNT_MISMATCH',
  'MAILBOX_UNAVAILABLE',
  /** The draft cannot be sent as is (additional_information.issues lists why). */
  'DRAFT_NOT_SENDABLE',
  /** The draft was already sent, or the outbox email is no longer cancellable. */
  'EMAIL_STATE_CONFLICT',
  /**
   * Publishing a workflow whose draft has errors (400; additional_information.checklist and .issues per block:
   * "Please fix the {count} errors in the workflow and try again.").
   */
  'WORKFLOW_INVALID',
  /**
   * The workflow or run is not in a state that allows this (409): triggering a draft-only workflow, deleting a live
   * or already-run workflow, retrying a run that has not failed, editing an immutable version.
   */
  'WORKFLOW_STATE_CONFLICT',
  // Slice 10 (AI layer).
  /** No LLM provider key is configured (503): AI features show their "not configured" state. */
  'AI_NOT_CONFIGURED',
  /** The LLM provider failed, rate-limited or refused the request (502 / 429). */
  'AI_PROVIDER_ERROR',
  /** The member's and the workspace's Ask Agentic credits are used up, or the workspace budget is reached (402). */
  'CREDITS_EXHAUSTED',
  /** The AI thread turn is not in a state that allows this (409): approving a resolved tool call, retrying a running turn. */
  'AI_TURN_STATE_CONFLICT',
  // Slice 10 (formula and AI attributes; formulas.md §3.6). additional_information.diagnostics on HAS_ERRORS.
  'FORMULA_EMPTY',
  'FORMULA_HAS_ERRORS',
  'FORMULA_CIRCULAR_REFERENCE',
  'FORMULA_MAX_DEPTH_EXCEEDED',
  'FORMULA_TYPECHECK_FAILED',
  // Slice 10 (calls, insight templates).
  /** Publishing or previewing an insight template with empty section titles / prompts (additional_information.issues). */
  'TEMPLATE_INCOMPLETE',
  /** Templates that have been used by call insights cannot be deleted. */
  'TEMPLATE_IN_USE',
  /** Only the draft version of a template can be changed or discarded. */
  'SNAPSHOT_NOT_DRAFT',
  'UNKNOWN_ERROR',
] as const;
export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  status_code: z.number().int(),
  additional_information: z.looseObject({ code: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function httpReason(status: number): string {
  return REASONS[status] ?? 'Error';
}

export function makeErrorEnvelope(
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ErrorEnvelope {
  return {
    statusCode,
    error: httpReason(statusCode),
    message,
    status_code: statusCode,
    additional_information: { ...extra, code },
  };
}
