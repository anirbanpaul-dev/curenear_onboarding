/** Queue names and retry policy for the background worker (pg-boss). */
export const queueNames = {
  outbox: 'outbox-dispatch',
  documentExpiry: 'document-expiry-scan',
  staleDrafts: 'stale-draft-reminders',
  outboxCleanup: 'outbox-cleanup',
  sessionPrune: 'session-prune',
  pinStatsCheck: 'pin-stats-consistency-check',
  webhookDeliveries: 'webhook-deliveries-dispatch',
  exportJobs: 'export-jobs',
  exportCleanup: 'export-cleanup',
} as const;

export const queueList = [
  queueNames.outbox,
  queueNames.documentExpiry,
  queueNames.staleDrafts,
  queueNames.outboxCleanup,
  queueNames.sessionPrune,
  queueNames.pinStatsCheck,
  queueNames.webhookDeliveries,
  queueNames.exportJobs,
  queueNames.exportCleanup,
];

/** Exponential backoff starting at 10s, capped at 15 minutes. */
export function retryDelaySeconds(attempts: number): number {
  const safeAttempts = Math.max(0, Math.min(attempts, 10));
  return Math.min(2 ** safeAttempts * 5, 15 * 60);
}

export function nextAttemptAt(
  attempts: number,
  now: Date = new Date(),
  delaySeconds: (attempts: number) => number = retryDelaySeconds,
): Date {
  return new Date(now.getTime() + delaySeconds(attempts) * 1000);
}
