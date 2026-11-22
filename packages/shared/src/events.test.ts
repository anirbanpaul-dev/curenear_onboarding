import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import {
  assertEventPayloadIsSafe,
  canonicalEventType,
  eventAliases,
  eventCatalogue,
  eventDefinitionFor,
  outboxEventTypes,
  outboxEventVersions,
  toEnvelope,
  validateEventPayload,
} from './events';

const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';

describe('domain event catalogue', () => {
  it('has a unique, versioned definition for every event', () => {
    expect(outboxEventTypes.length).toBeGreaterThan(20);
    expect(new Set(outboxEventTypes).size).toBe(outboxEventTypes.length);
    for (const type of outboxEventTypes) {
      const definition = eventCatalogue[type];
      expect(definition, type).toBeDefined();
      expect(definition.version, type).toBeGreaterThanOrEqual(1);
      expect(definition.description, type).toBeTruthy();
      expect(definition.schema, type).toBeDefined();
      expect(outboxEventVersions[type]).toBe(definition.version);
    }
  });

  it('resolves retired names to their catalogue replacements', () => {
    for (const [alias, canonical] of Object.entries(eventAliases)) {
      expect(canonicalEventType(alias)).toBe(canonical);
      expect(eventDefinitionFor(alias)?.version).toBe(eventCatalogue[canonical].version);
    }
    expect(canonicalEventType('provider.approved')).toBe('provider.approved');
    expect(canonicalEventType('not.an.event')).toBe('not.an.event');
    expect(eventDefinitionFor('not.an.event')).toBeNull();
  });

  it('validates a lifecycle payload and rejects unknown events', () => {
    const payload = {
      organizationId: id,
      providerType: 'clinic',
      status: 'SUBMITTED',
      recordVersion: 3,
      actorUserId: actor,
    };
    expect(validateEventPayload('provider.submitted', payload).success).toBe(true);
    expect(
      validateEventPayload('provider.submitted', { ...payload, recordVersion: 0 }).success,
    ).toBe(false);

    const unknown = validateEventPayload('nope', {});
    expect(unknown.success).toBe(false);
    if (!unknown.success) {
      expect(unknown.error.issues[0]?.message).toContain('Unknown event type');
    }
  });

  it('validates a lifecycle payload sent under a retired alias', () => {
    const legacy = {
      organizationId: id,
      providerType: 'doctor',
      status: 'APPROVED',
      recordVersion: 2,
      actorUserId: null,
    };
    expect(validateEventPayload('provider.review.approved', legacy).success).toBe(true);
    expect(
      validateEventPayload('provider.review.approved', { ...legacy, organizationId: 'x' }).success,
    ).toBe(false);
  });

  it('builds the wire envelope without leaking extra fields', () => {
    const occurredAt = new Date('2026-11-22T10:00:00.000Z');
    const envelope = toEnvelope({
      id,
      eventType: 'provider.approved',
      eventVersion: 2,
      aggregateType: 'provider_organization',
      aggregateId: actor,
      occurredAt,
      payload: { organizationId: actor },
    });
    expect(envelope).toEqual({
      id,
      type: 'provider.approved',
      version: 2,
      aggregate: { type: 'provider_organization', id: actor },
      occurredAt: '2026-11-22T10:00:00.000Z',
      payload: { organizationId: actor },
    });
  });

  it('refuses payloads carrying personal data', () => {
    expect(() => assertEventPayloadIsSafe({ organizationId: id })).not.toThrow();
    for (const key of ['name', 'email', 'mobile', 'document']) {
      try {
        assertEventPayloadIsSafe({ organizationId: id, [key]: 'leak' });
        throw new Error('expected the guard to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('INTERNAL_ERROR');
        expect((error as AppError).details).toMatchObject({ leaked: [key] });
      }
    }
  });
});
