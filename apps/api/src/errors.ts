// Shared HTTP error envelope:
//   {"statusCode":409,"error":"Conflict","message":"…","status_code":409,"additional_information":{…}}
import { STATUS_CODES } from 'node:http';
import { isPgError } from './db';

export interface ErrorEnvelope {
  statusCode: number;
  /** HTTP reason phrase, e.g. "Conflict". */
  error: string;
  message: string;
  status_code: number;
  additional_information?: Record<string, unknown>;
}

/** Message returned when a session is missing or expired. */
export const UNAUTHENTICATED_MESSAGE = 'The requesting user did not present an authentication token';
const INTERNAL_MESSAGE = 'An unexpected error occurred';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly additionalInformation: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    message: string,
    additionalInformation?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.additionalInformation = additionalInformation;
  }
}

export function reasonPhrase(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? 'Error';
}

export function toEnvelope(err: ApiError): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    statusCode: err.statusCode,
    error: reasonPhrase(err.statusCode),
    message: err.message,
    status_code: err.statusCode,
  };
  if (err.additionalInformation && Object.keys(err.additionalInformation).length > 0) {
    envelope.additional_information = err.additionalInformation;
  }
  return envelope;
}

export function envelope(
  statusCode: number,
  message: string,
  additionalInformation?: Record<string, unknown>,
): ErrorEnvelope {
  return toEnvelope(new ApiError(statusCode, message, additionalInformation));
}

/** Domain error codes (string `code` on errors thrown by packages/domain) → HTTP status. */
const DOMAIN_CODE_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 400,
  VALIDATION_ERROR: 400,
  INVALID: 400,
  UNAUTHORIZED: 401,
  UNAUTHENTICATED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNIQUE_VIOLATION: 409,
  ALREADY_EXISTS: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  UNPROCESSABLE_CONTENT: 422,
  LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429,
  TOO_MANY_REQUESTS: 429,
  NOT_IMPLEMENTED: 501,
  UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
};

function statusField(err: Record<string, unknown>): number | undefined {
  for (const key of ['statusCode', 'status_code', 'httpStatus', 'status']) {
    const value = err[key];
    if (typeof value === 'number' && value >= 400 && value <= 599) return value;
  }
  return undefined;
}

function additionalField(err: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['additionalInformation', 'additional_information', 'details']) {
    const value = err[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return undefined;
}

function isZodLikeError(err: unknown): err is { issues: { path: PropertyKey[]; message: string; code: string }[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as { issues?: unknown }).issues) &&
    ((err as { name?: unknown }).name === 'ZodError' || (err as { name?: unknown }).name === '$ZodError')
  );
}

export function validationInfo(err: {
  issues: { path: PropertyKey[]; message: string; code: string }[];
}): Record<string, unknown> {
  return {
    validation_errors: err.issues.map((issue) => ({
      path: issue.path.map((p) => (typeof p === 'symbol' ? p.toString() : p)),
      code: issue.code,
      message: issue.message,
    })),
  };
}

/**
 * Normalises anything thrown into an ApiError. Recognises ApiError, duck-typed domain errors
 * (`{code: 'NOT_FOUND' | 'not-found' | …}` and/or a numeric status field), Zod errors, Postgres errors and
 * Fastify/HTTP errors with a status. Everything else is a 500 with a generic message.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (isZodLikeError(err)) return new ApiError(400, 'Invalid request', validationInfo(err), { cause: err });
  if (isPgError(err)) {
    switch (err.code) {
      case '23505':
        return new ApiError(409, 'A value that must be unique is already in use', {
          ...(err.constraint ? { constraint: err.constraint } : {}),
        });
      case '23503':
        return new ApiError(400, 'A referenced resource does not exist', {
          ...(err.constraint ? { constraint: err.constraint } : {}),
        });
      case '22P02':
        return new ApiError(400, 'Invalid input syntax');
      case '40001':
      case '40P01':
        return new ApiError(409, 'The request conflicted with a concurrent change, please retry');
      default:
        return new ApiError(500, INTERNAL_MESSAGE, undefined, { cause: err });
    }
  }
  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    const rawCode = typeof record.code === 'string' ? record.code.toUpperCase().replaceAll('-', '_') : undefined;
    const status = statusField(record) ?? (rawCode ? DOMAIN_CODE_STATUS[rawCode] : undefined);
    if (status !== undefined) {
      const message =
        status >= 500 ? INTERNAL_MESSAGE : typeof record.message === 'string' ? record.message : reasonPhrase(status);
      return new ApiError(status, message, status >= 500 ? undefined : additionalField(record), { cause: err });
    }
  }
  return new ApiError(500, INTERNAL_MESSAGE, undefined, { cause: err });
}
