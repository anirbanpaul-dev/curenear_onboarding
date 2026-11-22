import type { OutboxEventRecord } from '@curenear/shared';
import type { AppContext } from '../context';

/**
 * One internal consumer of outbox events. `handles` receives the canonical event
 * type, and `handle` must be idempotent: it may run twice for the same event
 * (the publisher records a marker per handler, but a crash can happen between
 * the work and the marker).
 */
export interface EventHandler {
  name: string;
  handles(eventType: string): boolean;
  handle(event: OutboxEventRecord, ctx: AppContext): Promise<void>;
}
