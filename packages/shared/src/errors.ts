/** Stable machine-readable error codes for the public API envelope. */
export const errorCodes = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_MISMATCH',
  'PASSWORD_CHANGE_REQUIRED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_MISMATCH: 409,
  PASSWORD_CHANGE_REQUIRED: 403,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    if (details !== undefined) this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
