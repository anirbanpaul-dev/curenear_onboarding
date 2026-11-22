import { aggregatorHandler } from './aggregator';
import { notificationsHandler } from './notifications';
import { pinStatsHandler } from './pin-stats';
import { searchIndexHandler } from './search-index';
import type { EventHandler } from './types';
import { webhooksHandler } from './webhooks';

/**
 * Every handler runs for every event it claims, in this order. All of them are
 * idempotent, so the outbox can replay an event after a crash.
 */
export const eventHandlers: EventHandler[] = [
  pinStatsHandler,
  searchIndexHandler,
  notificationsHandler,
  webhooksHandler,
  aggregatorHandler,
];

export type { EventHandler } from './types';
