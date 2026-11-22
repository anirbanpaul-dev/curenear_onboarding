import { describe, expect, it } from 'vitest';
import {
  eventIdParamsSchema,
  jobRunsQuerySchema,
  systemEventsQuerySchema,
  webhookEndpointCreateSchema,
  webhookEndpointParamsSchema,
} from './system';

const id = '11111111-1111-4111-8111-111111111111';

describe('system administration schemas', () => {
  it('defaults the outbox console query and coerces paging', () => {
    expect(systemEventsQuerySchema.parse({})).toEqual({
      status: 'all',
      page: 1,
      pageSize: 25,
    });
    expect(
      systemEventsQuerySchema.parse({
        status: 'dead',
        eventType: ' provider.approved ',
        page: '3',
        pageSize: '100',
      }),
    ).toMatchObject({ status: 'dead', eventType: 'provider.approved', page: 3, pageSize: 100 });
    expect(systemEventsQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false);
    expect(systemEventsQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(systemEventsQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it('defaults the job history query', () => {
    expect(jobRunsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(jobRunsQuerySchema.parse({ page: '2' }).page).toBe(2);
    expect(jobRunsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('requires UUID path parameters and nothing else', () => {
    expect(eventIdParamsSchema.parse({ id }).id).toBe(id);
    expect(webhookEndpointParamsSchema.safeParse({ id }).success).toBe(true);
    expect(eventIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(eventIdParamsSchema.safeParse({ id, extra: true }).success).toBe(false);
  });

  it('accepts an https webhook and rejects unsafe or oversized endpoints', () => {
    expect(
      webhookEndpointCreateSchema.parse({
        url: ' https://aggregator.example.com/hooks ',
        description: 'Aggregator',
        event_types: ['provider.approved', 'document.expiring'],
        active: true,
      }),
    ).toMatchObject({
      url: 'https://aggregator.example.com/hooks',
      event_types: ['provider.approved', 'document.expiring'],
      active: true,
    });
    expect(
      webhookEndpointCreateSchema.safeParse({ url: 'http://insecure.example.com' }).success,
    ).toBe(true);
    expect(webhookEndpointCreateSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
    expect(
      webhookEndpointCreateSchema.safeParse({ url: `https://x.test/${'a'.repeat(2000)}` }).success,
    ).toBe(false);
    expect(
      webhookEndpointCreateSchema.safeParse({
        url: 'https://x.test/hook',
        event_types: Array.from({ length: 51 }, () => 'provider.approved'),
      }).success,
    ).toBe(false);
    expect(
      webhookEndpointCreateSchema.safeParse({ url: 'https://x.test/hook', unexpected: true })
        .success,
    ).toBe(false);
  });
});
