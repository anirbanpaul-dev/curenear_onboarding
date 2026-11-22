import type { EventHandler } from './types';

/**
 * Refreshes `provider_search_index`, the denormalized row directory search reads
 * (code, type, status, PIN, city, doctor count). Refreshing from the live tables
 * means a replay writes the same values rather than applying a delta twice.
 */
export const searchIndexHandler: EventHandler = {
  name: 'search-index',
  handles: (eventType) =>
    eventType.startsWith('provider.') || eventType === 'doctor.linked_to_clinic',

  async handle(event, ctx) {
    const organizationId =
      event.aggregateType === 'provider_organization' ? event.aggregateId : null;

    const payloadOrganizationId =
      typeof event.payload.organizationId === 'string'
        ? event.payload.organizationId
        : typeof event.payload.providerId === 'string'
          ? event.payload.providerId
          : null;

    const id = organizationId ?? payloadOrganizationId;
    if (!id) return;

    if (event.eventType === 'provider.deleted') {
      await ctx.repositories.system.removeProviderSearchIndex(id);
      return;
    }
    await ctx.repositories.system.refreshProviderSearchIndex(id, ctx.now());
  },
};
