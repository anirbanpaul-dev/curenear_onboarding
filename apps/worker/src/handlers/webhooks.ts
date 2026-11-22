import { canonicalEventType, toEnvelope } from '@curenear/shared';
import type { EventHandler } from './types';

/**
 * Prompt 20: every event that matches a registered endpoint becomes a delivery
 * row. Delivery itself is a separate pg-boss job (`webhook-deliveries`), so a
 * slow or broken subscriber never delays the outbox.
 */
export const webhooksHandler: EventHandler = {
  name: 'webhook-deliveries',
  handles: () => true,

  async handle(event, ctx) {
    const endpoints = await ctx.repositories.system.webhookEndpoints();
    if (endpoints.length === 0) return;

    const canonical = canonicalEventType(event.eventType);
    const envelope = toEnvelope(event);

    for (const endpoint of endpoints) {
      if (!endpoint.active) continue;
      const subscribed =
        endpoint.eventTypes.length === 0 ||
        endpoint.eventTypes.includes('*') ||
        endpoint.eventTypes.includes(canonical) ||
        endpoint.eventTypes.includes(event.eventType);
      if (!subscribed) continue;

      await ctx.repositories.system.createWebhookDelivery({
        id: crypto.randomUUID(),
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: canonical,
        payload: envelope as unknown as Record<string, unknown>,
        createdAt: ctx.now(),
      });
    }
  },
};
