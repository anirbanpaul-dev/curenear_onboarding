import { z } from 'zod';

/**
 * Admin-facing shapes for the event pipeline: the outbox console and the job
 * history. They carry identifiers and outcomes only — never payload contents.
 */

export const systemEventsQuerySchema = z
  .object({
    status: z.enum(['all', 'pending', 'published', 'dead']).default('all'),
    eventType: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type SystemEventsQuery = z.infer<typeof systemEventsQuerySchema>;

export const jobRunsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type JobRunsQuery = z.infer<typeof jobRunsQuerySchema>;

export const eventIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const webhookEndpointParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** An endpoint with no event types receives every event; `*` means the same. */
export const webhookEndpointCreateSchema = z
  .object({
    url: z.string().trim().url('Enter an https URL').max(2000),
    description: z.string().trim().max(200).optional(),
    event_types: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type WebhookEndpointCreateInput = z.infer<typeof webhookEndpointCreateSchema>;

export interface WebhookEndpointDto {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminEventDto {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  attempts: number;
  occurredAt: string;
  publishedAt: string | null;
  deadLetteredAt: string | null;
  nextAttemptAt: string;
  lastError: string | null;
}

export interface AdminEventsResult {
  rows: AdminEventDto[];
  total: number;
  deadCount: number;
  page: number;
  pageSize: number;
}

export interface JobRunDto {
  id: string;
  queue: string;
  status: 'SUCCEEDED' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface JobRunsResult {
  rows: JobRunDto[];
  total: number;
  page: number;
  pageSize: number;
}
