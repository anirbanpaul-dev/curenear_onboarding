import { describe, expect, it } from 'vitest';
import { nextAttemptAt, queueList, queueNames, retryDelaySeconds } from './queues';

describe('worker queues', () => {
  it('lists every registered queue once', () => {
    expect(queueList).toEqual([
      'outbox-dispatch',
      'document-expiry-scan',
      'stale-draft-reminders',
      'outbox-cleanup',
      'session-prune',
      'pin-stats-consistency-check',
      'webhook-deliveries-dispatch',
      'export-jobs',
      'export-cleanup',
    ]);
    expect(new Set(queueList).size).toBe(queueList.length);
    expect(queueNames.outbox).toBe('outbox-dispatch');
  });

  it('backs off exponentially and caps at 15 minutes', () => {
    expect(retryDelaySeconds(0)).toBe(5);
    expect(retryDelaySeconds(1)).toBe(10);
    expect(retryDelaySeconds(3)).toBe(40);
    expect(retryDelaySeconds(20)).toBe(900);
  });

  it('computes the next attempt from the given clock', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(nextAttemptAt(2, now).toISOString()).toBe('2026-01-01T00:00:20.000Z');
  });
});
