import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ProviderStatus, Role } from '@curenear/shared';
import { getPrismaClient } from './client';

/**
 * A Prisma transaction client. Root clients are structurally similar but carry
 * `$transaction`; the helpers below reject them at runtime, which keeps audit and
 * outbox writes inside the transaction that made the change.
 */
export type Tx = Prisma.TransactionClient;

function assertTransactionClient(tx: Tx, helper: string): void {
  if (typeof (tx as unknown as { $transaction?: unknown }).$transaction === 'function') {
    throw new Error(
      `${helper} must be called inside withTransaction: pass the transaction client, not the root Prisma client`,
    );
  }
}

/**
 * Runs `work` in a single transaction against the shared client. Audit rows and
 * outbox events written through this client commit or roll back with the change.
 */
export async function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  client: PrismaClient = getPrismaClient(),
): Promise<T> {
  return client.$transaction(work, { maxWait: 5_000, timeout: 20_000 });
}

export interface AuditEntryInput {
  actorUserId?: string | null;
  actorRole?: Role | null;
  /** Dotted verb, e.g. "staff.create". */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
  /** Field keys that changed — never field values. */
  changedFieldKeys?: string[];
  fromStatus?: ProviderStatus | null;
  toStatus?: ProviderStatus | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
}

/** Appends one audit row. Must run inside {@link withTransaction}. */
export async function writeAudit(
  tx: Tx,
  entry: AuditEntryInput,
): Promise<{ id: string; occurredAt: Date }> {
  assertTransactionClient(tx, 'writeAudit');

  const occurredAt = entry.occurredAt ?? new Date();

  return tx.auditLog.create({
    data: {
      id: randomUUID(),
      occurredAt,
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: entry.requestId ?? null,
      changedFieldKeys: entry.changedFieldKeys ?? [],
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      reason: entry.reason ?? null,
      ipAddress: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
    select: { id: true, occurredAt: true },
  });
}

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  eventVersion?: number;
  occurredAt?: Date;
  dedupeKey?: string | null;
}

/** Appends one outbox event. Must run inside {@link withTransaction}. */
export async function emitEvent(tx: Tx, event: OutboxEventInput): Promise<string> {
  assertTransactionClient(tx, 'emitEvent');

  const id = randomUUID();
  await tx.outboxEvent.create({
    data: {
      id,
      eventType: event.eventType,
      eventVersion: event.eventVersion ?? 1,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload as Prisma.InputJsonValue,
      occurredAt: event.occurredAt ?? new Date(),
      dedupeKey: event.dedupeKey ?? null,
    },
  });
  return id;
}
