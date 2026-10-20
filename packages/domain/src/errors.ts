// Domain errors map 1:1 onto the Attio error envelope (contracts/errors.ts). Transports call toErrorEnvelope().
import { type ErrorCode, type ErrorEnvelope, makeErrorEnvelope } from '@agentic-crm/contracts';
import { ZodError } from 'zod';

export class DomainError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(statusCode: number, code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  /** HTTP status (alias read by transports that duck-type errors). */
  get status(): number {
    return this.statusCode;
  }

  /** The envelope's additional_information, including the stable code. */
  get additionalInformation(): Record<string, unknown> {
    return { ...this.details, code: this.code };
  }

  toEnvelope(): ErrorEnvelope {
    return makeErrorEnvelope(this.statusCode, this.code, this.message, this.details);
  }
}

export const badRequest = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new DomainError(400, code, message, details);
export const notFound = (message: string, details?: Record<string, unknown>, code: ErrorCode = 'NOT_FOUND') =>
  new DomainError(404, code, message, details);
export const conflict = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new DomainError(409, code, message, details);
export const forbidden = (message: string, details?: Record<string, unknown>) =>
  new DomainError(403, 'FORBIDDEN', message, details);

export function valueError(attributeId: string, reason: string, message: string): DomainError {
  return badRequest('VALUE_VALIDATION_FAILED', message, { attribute_definition_id: attributeId, reason });
}

/** Any thrown value → Attio envelope (Zod issues become 400 VALIDATION_ERROR). */
export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof DomainError) return err.toEnvelope();
  if (err instanceof ZodError) {
    return makeErrorEnvelope(400, 'VALIDATION_ERROR', 'The request body is invalid', {
      validation_errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    });
  }
  return makeErrorEnvelope(500, 'UNKNOWN_ERROR', 'An unexpected error occurred');
}
