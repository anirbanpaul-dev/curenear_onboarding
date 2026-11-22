import { toEnvelope } from '@curenear/shared';
import type { EventHandler } from './types';

/**
 * Forwards events to the consumer aggregator when one is configured. Kept as a
 * handler so a failure here retries with the rest of the event instead of
 * blocking or silently dropping the delivery.
 */
export const aggregatorHandler: EventHandler = {
  name: 'consumer-aggregator',
  handles: () => true,

  async handle(event, ctx) {
    const url = ctx.env.AGGREGATOR_WEBHOOK_URL;
    if (!url) return;

    const response = await ctx.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ctx.env.AGGREGATOR_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${ctx.env.AGGREGATOR_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(toEnvelope(event)),
    });

    if (!response.ok) {
      throw new Error(`Aggregator webhook responded ${response.status}`);
    }
  },
};
