import type { ErrorCode } from './errors';
import type { AppError } from './errors';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string;
  order: 'asc' | 'desc';
}

export interface ApiSuccessBody<T> {
  data: T;
  meta?: PageMeta | Record<string, unknown>;
  requestId: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export function successBody<T>(
  data: T,
  requestId: string,
  meta?: PageMeta | Record<string, unknown>,
): ApiSuccessBody<T> {
  return meta === undefined ? { data, requestId } : { data, meta, requestId };
}

export function errorBody(error: AppError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
}

export function pageMeta(input: {
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  order: 'asc' | 'desc';
}): PageMeta {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages: Math.max(1, Math.ceil(input.total / input.pageSize)),
    sort: input.sort,
    order: input.order,
  };
}
