import { AppError, type ErrorCode } from '@curenear/shared';

/**
 * Base class for errors that map onto an HTTP status and a stable API error code.
 * Throw these from route handlers; the wrapper turns them into the envelope.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Sign in to continue') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have access to this resource') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'The request conflicts with the current state', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'A required dependency is unavailable', details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}

/** Domain errors raised by services are already HTTP-shaped. */
export function fromAppError(error: AppError): HttpError {
  const mapped = new HttpError(error.status, error.code, error.message, error.details);
  mapped.stack = error.stack;
  return mapped;
}
