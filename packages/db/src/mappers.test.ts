import { describe, expect, it } from 'vitest';
import { mapOutboxEvent, mapProvider, toJsonObject } from './mappers';

describe('prisma row mappers', () => {
  it('normalises non-object JSON columns to an empty object', () => {
    expect(toJsonObject(null)).toEqual({});
    expect(toJsonObject(['a'])).toEqual({});
    expect(toJsonObject({ a: 1 })).toEqual({ a: 1 });
  });

  it('maps a provider row to the domain record without leaking Prisma shapes', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const provider = mapProvider({
      id: 'p1',
      providerType: 'doctor',
      status: 'draft',
      displayName: null,
      legalName: null,
      data: { reg_city: 'Kolkata' },
      primaryPinCode: null,
      city: 'Kolkata',
      version: 1,
      createdByUserId: 'u1',
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      decisionReason: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    } as never);

    expect(provider).toMatchObject({ id: 'p1', providerType: 'doctor', version: 1 });
    expect(provider.data).toEqual({ reg_city: 'Kolkata' });
  });

  it('keeps outbox payload untouched', () => {
    const event = mapOutboxEvent({
      id: 'e1',
      eventType: 'provider.created',
      eventVersion: 1,
      aggregateType: 'provider',
      aggregateId: 'p1',
      payload: { providerId: 'p1', status: 'draft' },
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: null,
      attempts: 0,
      lastError: null,
      dedupeKey: null,
    } as never);

    expect(event.payload).toEqual({ providerId: 'p1', status: 'draft' });
    expect(event.publishedAt).toBeNull();
  });
});
