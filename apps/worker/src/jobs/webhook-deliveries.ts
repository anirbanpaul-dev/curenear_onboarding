import type { AppContext } from '../context';

const MAX_PER_RUN = 50;

export interface WebhookDeliverySummary extends Record<string, unknown> {
  attempted: number;
  delivered: number;
  retrying: number;
  failed: number;
}

/**
 * Attempts pending webhook deliveries. Failed deliveries back off exponentially
 * and become FAILED after `WEBHOOK_MAX_ATTEMPTS`; they stay in the database for
 * inspection. Delivery is at-least-once — subscribers must de-duplicate on the
 * envelope `id`.
 */
export async function runWebhookDeliveries(
  ctx: AppContext,
  options: { now?: Date } = {},
): Promise<WebhookDeliverySummary> {
  const now = options.now ?? ctx.now();
  const summary: WebhookDeliverySummary = {
    attempted: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
  };

  const [deliveries, endpoints] = await Promise.all([
    ctx.repositories.system.pendingWebhookDeliveries(MAX_PER_RUN, now),
    ctx.repositories.system.webhookEndpoints(),
  ]);
  const urls = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.url]));

  for (const delivery of deliveries) {
    const url = urls.get(delivery.endpointId);
    if (!url) continue;

    summary.attempted += 1;
    const attempts = delivery.attempts + 1;

    try {
      const response = await ctx.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delivery.payload),
      });
      if (!response.ok) throw new Error(`Subscriber responded ${response.status}`);
      await ctx.repositories.system.markWebhookDelivered(delivery.id, now);
      summary.delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const exhausted = attempts >= ctx.env.WEBHOOK_MAX_ATTEMPTS;
      const delaySeconds = Math.min(2 ** Math.min(attempts, 10) * 5, 15 * 60);
      await ctx.repositories.system.markWebhookFailed({
        id: delivery.id,
        error: message,
        attempts,
        nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
        status: exhausted ? 'FAILED' : 'PENDING',
      });
      if (exhausted) summary.failed += 1;
      else summary.retrying += 1;
    }
  }

  return summary;
}
