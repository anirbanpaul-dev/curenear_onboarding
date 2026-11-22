import { recomputeProviderPinStats } from '@curenear/db';
import type { EventHandler } from './types';

/**
 * Keeps `provider_pin_stats` in step with the provider lifecycle. The recompute
 * is a diff against `provider_pin_contributions`, so a replayed event adds and
 * subtracts exactly the same rows and leaves the read model unchanged.
 *
 * `provider.deleted` is handled like any other event: the live contribution
 * query excludes soft-deleted organisations, so the recompute removes every
 * contribution the deleted provider had and decrements the PIN rows. Skipping
 * the event would leave the read model counting a provider that no longer
 * exists.
 */
export const pinStatsHandler: EventHandler = {
  name: 'pin-stats',
  handles: (eventType) =>
    eventType.startsWith('provider.') && eventType !== 'provider.verification.updated',

  async handle(event, ctx) {
    if (event.aggregateType !== 'provider_organization') return;
    await recomputeProviderPinStats(ctx.prisma, event.aggregateId);
  },
};
