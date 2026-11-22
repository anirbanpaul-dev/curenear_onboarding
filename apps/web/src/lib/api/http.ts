import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@curenear/shared';

function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

type InputAgnosticSchema<Output> = z.ZodType<Output, z.ZodTypeDef, unknown>;

export async function parseBody<Output>(
  req: NextRequest,
  schema: InputAgnosticSchema<Output>,
): Promise<Output> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
      issues: issuesOf(parsed.error),
    });
  }
  return parsed.data;
}

/** Builds a plain object from the query string, preserving repeated keys. */
export function queryObject(req: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

export function parseQuery<Output>(req: NextRequest, schema: InputAgnosticSchema<Output>): Output {
  const parsed = schema.safeParse(queryObject(req));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Query parameters are invalid', {
      issues: issuesOf(parsed.error),
    });
  }
  return parsed.data;
}

export function parseParams<Output>(
  params: Record<string, string>,
  schema: InputAgnosticSchema<Output>,
): Output {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Path parameters are invalid', {
      issues: issuesOf(parsed.error),
    });
  }
  return parsed.data;
}

export function idempotencyKeyFrom(req: NextRequest): string | undefined {
  const value = req.headers.get('idempotency-key');
  if (!value) return undefined;
  if (value.length < 8 || value.length > 200) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 8-200 characters');
  }
  return value;
}
