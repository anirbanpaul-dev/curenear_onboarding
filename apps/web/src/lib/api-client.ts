import type { ApiErrorBody, ApiSuccessBody, PageMeta } from '@curenear/shared';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId: string;
  }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; form?: FormData } = {},
): Promise<{ data: T; meta?: PageMeta; requestId: string }> {
  const { json, form, headers, ...rest } = init;
  const requestBody = form ?? (json === undefined ? undefined : JSON.stringify(json));
  const response = await fetch(path, {
    ...rest,
    headers: {
      // The browser sets the multipart boundary itself.
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    },
    ...(requestBody === undefined ? {} : { body: requestBody }),
    credentials: 'same-origin',
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiClientError({
      code: body?.error?.code ?? 'INTERNAL_ERROR',
      message: body?.error?.message ?? 'Request failed',
      status: response.status,
      details: body?.error?.details,
      requestId: body?.error?.requestId ?? response.headers.get('x-request-id') ?? 'unknown',
    });
  }

  const body = payload as ApiSuccessBody<T>;
  return { data: body.data, meta: body.meta as PageMeta | undefined, requestId: body.requestId };
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, json?: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: 'POST', json, headers }),
  patch: <T>(path: string, json: unknown) => request<T>(path, { method: 'PATCH', json }),
  delete: <T>(path: string, json?: unknown) => request<T>(path, { method: 'DELETE', json }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};
