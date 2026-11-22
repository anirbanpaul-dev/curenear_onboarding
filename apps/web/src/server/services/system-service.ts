import {
  AppError,
  can,
  eventDefinitionFor,
  type Actor,
  type AdminEventDto,
  type AdminEventsResult,
  type JobRunDto,
  type JobRunsResult,
  type JobRunsQuery,
  type SystemEventsQuery,
  type WebhookEndpointCreateInput,
  type WebhookEndpointDto,
  type WebhookEndpointRecord,
} from '@curenear/shared';
import type { RequestContext, ServiceDeps } from './service-deps';

function toWebhookDto(row: WebhookEndpointRecord): WebhookEndpointDto {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes: row.eventTypes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Operational visibility for administrators: dead-lettered outbox events and the
 * pg-boss job history. Retrying a dead letter clears the marker so the publisher
 * claims it again on its next tick.
 */
export function createSystemService(deps: ServiceDeps) {
  function assertOperator(actor: Actor): void {
    if (!can(actor, 'system.manage')) {
      throw new AppError('FORBIDDEN', 'Only administrators can view system events');
    }
  }

  async function audit(
    actor: Actor,
    action: string,
    entityId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await deps.repositories.audits.append({
      id: deps.newId(),
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      entityType: 'webhook_endpoint',
      entityId,
      requestId: ctx.requestId,
      changedFieldKeys: [],
      fromStatus: null,
      toStatus: null,
      reason: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      createdAt: deps.now(),
    });
  }

  return {
    async events(actor: Actor, query: SystemEventsQuery): Promise<AdminEventsResult> {
      assertOperator(actor);
      const page = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
      const result = await deps.repositories.system.outboxList(
        {
          status: query.status,
          eventType: query.eventType?.trim() ? query.eventType.trim() : null,
        },
        page,
      );

      const rows: AdminEventDto[] = result.rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        attempts: row.attempts,
        occurredAt: row.occurredAt.toISOString(),
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        deadLetteredAt: row.deadLetteredAt ? row.deadLetteredAt.toISOString() : null,
        nextAttemptAt: row.nextAttemptAt.toISOString(),
        lastError: row.lastError,
      }));

      return {
        rows,
        total: result.total,
        deadCount: result.deadCount,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async retry(actor: Actor, id: string, ctx: RequestContext): Promise<{ retried: true }> {
      assertOperator(actor);
      const retried = await deps.repositories.system.outboxRetry(id, deps.now());
      if (!retried) {
        throw new AppError('NOT_FOUND', 'No dead-lettered event with this id');
      }

      await deps.repositories.audits.append({
        id: deps.newId(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'system.event.retried',
        entityType: 'outbox_event',
        entityId: id,
        requestId: ctx.requestId,
        changedFieldKeys: [],
        fromStatus: null,
        toStatus: null,
        reason: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: deps.now(),
      });

      return { retried: true };
    },

    async webhooks(actor: Actor): Promise<WebhookEndpointDto[]> {
      assertOperator(actor);
      const rows = await deps.repositories.system.webhookEndpoints();
      return rows.map(toWebhookDto);
    },

    /**
     * Registers a subscriber. An empty `event_types` list (or `*`) receives every
     * event; named types must exist in the catalogue so a typo cannot silently
     * subscribe to nothing.
     */
    async saveWebhook(
      actor: Actor,
      input: WebhookEndpointCreateInput,
      ctx: RequestContext,
    ): Promise<WebhookEndpointDto> {
      assertOperator(actor);
      const eventTypes = input.event_types ?? [];
      const unknown = eventTypes.filter(
        (type) => type !== '*' && eventDefinitionFor(type) === null,
      );
      if (unknown.length > 0) {
        throw new AppError('VALIDATION_ERROR', 'Unknown event type', { unknown });
      }

      const existing = await deps.repositories.system.webhookEndpoints();
      if (existing.some((row) => row.url === input.url)) {
        throw new AppError('CONFLICT', 'An endpoint with this URL already exists');
      }

      const saved = await deps.repositories.system.saveWebhookEndpoint({
        id: deps.newId(),
        url: input.url,
        description: input.description?.trim() ? input.description.trim() : null,
        eventTypes,
        active: input.active ?? true,
      });

      await audit(actor, 'system.webhook.created', saved.id, ctx);
      return toWebhookDto(saved);
    },

    async deleteWebhook(actor: Actor, id: string, ctx: RequestContext): Promise<{ deleted: true }> {
      assertOperator(actor);
      const removed = await deps.repositories.system.deleteWebhookEndpoint(id);
      if (!removed) throw new AppError('NOT_FOUND', 'Webhook endpoint not found');

      await audit(actor, 'system.webhook.deleted', id, ctx);
      return { deleted: true };
    },

    async jobs(actor: Actor, query: JobRunsQuery): Promise<JobRunsResult> {
      assertOperator(actor);
      const page = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
      const result = await deps.repositories.system.listJobRuns(page);

      const rows: JobRunDto[] = result.rows.map((row) => ({
        id: row.id,
        queue: row.queue,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt.toISOString(),
        durationMs: row.durationMs,
        summary: row.summary,
        error: row.error,
      }));

      return { rows, total: result.total, page: query.page, pageSize: query.pageSize };
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
