import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/client';
import { createRepositories } from '../../src/index';
import { emitEvent, withTransaction, writeAudit } from '../../src/transactions';

/**
 * These tests need a migrated PostgreSQL database (TEST_DATABASE_URL or DATABASE_URL).
 * Every row they write carries a per-run marker so they can assert on their own data
 * without touching anything else; audit rows are intentionally left behind because the
 * table is append-only.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('foundation schema (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  const marker = `foundation-${randomUUID()}`;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl as string);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('installs pgcrypto, citext and pg_trgm', async () => {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>(Prisma.sql`
      SELECT extname FROM pg_extension
      WHERE extname IN ('pgcrypto', 'citext', 'pg_trgm')
      ORDER BY extname
    `);
    expect(rows.map((row) => row.extname).sort()).toEqual(['citext', 'pg_trgm', 'pgcrypto'].sort());
  });

  it('stores the foundation tables under snake_case names', async () => {
    const tables = [
      'users',
      'sessions',
      'password_reset_tokens',
      'audit_logs',
      'outbox_events',
      'idempotency_keys',
      'settings',
    ];
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>(Prisma.sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${tables})
    `);
    expect(rows.map((row) => row.tablename).sort()).toEqual([...tables].sort());
  });

  it('rejects UPDATE on audit_logs and leaves the row untouched', async () => {
    const entry = await withTransaction(
      (tx) =>
        writeAudit(tx, {
          action: `${marker}.update-attempt`,
          entityType: 'foundation_test',
          entityId: marker,
        }),
      prisma,
    );

    await expect(
      prisma.$executeRaw(Prisma.sql`
        UPDATE "audit_logs" SET "reason" = 'tampered' WHERE "id" = ${entry.id}::uuid
      `),
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.auditLog.findUnique({ where: { id: entry.id } });
    expect(row?.reason).toBeNull();
    expect(row?.action).toBe(`${marker}.update-attempt`);
  });

  it('rejects DELETE on audit_logs and keeps the row', async () => {
    const entry = await withTransaction(
      (tx) =>
        writeAudit(tx, {
          action: `${marker}.delete-attempt`,
          entityType: 'foundation_test',
          entityId: marker,
        }),
      prisma,
    );

    await expect(
      prisma.$executeRaw(Prisma.sql`DELETE FROM "audit_logs" WHERE "id" = ${entry.id}::uuid`),
    ).rejects.toThrow(/append-only/i);

    expect(await prisma.auditLog.count({ where: { id: entry.id } })).toBe(1);
  });

  it('commits the audit row and the outbox event together', async () => {
    const eventType = `${marker}.committed`;
    const auditAction = `${eventType}.audit`;

    const result = await withTransaction(async (tx) => {
      const audit = await writeAudit(tx, {
        action: auditAction,
        entityType: 'foundation_test',
        entityId: marker,
      });
      const eventId = await emitEvent(tx, {
        eventType,
        aggregateType: 'foundation_test',
        aggregateId: marker,
        payload: { marker },
      });
      return { audit, eventId };
    }, prisma);

    expect(result.eventId).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: auditAction } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventType } })).toBe(1);
  });

  it('rolls the audit row and the outbox event back together', async () => {
    const eventType = `${marker}.rolled-back`;
    const auditAction = `${eventType}.audit`;

    await expect(
      withTransaction(async (tx) => {
        await writeAudit(tx, {
          action: auditAction,
          entityType: 'foundation_test',
          entityId: marker,
        });
        await emitEvent(tx, {
          eventType,
          aggregateType: 'foundation_test',
          aggregateId: marker,
          payload: { marker },
        });
        throw new Error('force rollback');
      }, prisma),
    ).rejects.toThrow('force rollback');

    expect(await prisma.auditLog.count({ where: { action: auditAction } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { eventType } })).toBe(0);
  });

  it('revokes a session on logout instead of deleting the row', async () => {
    const repositories = createRepositories(prisma);
    const user = await prisma.user.create({
      data: {
        email: `${marker}@session.test`,
        name: 'Session Test',
        passwordHash: 'not-a-real-hash',
        role: 'STAFF',
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const tokenHash = `${marker}-token`;
    const now = new Date();
    await repositories.sessions.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    expect(await repositories.sessions.findValidByTokenHash(tokenHash, now)).not.toBeNull();

    await repositories.sessions.revokeByTokenHash(tokenHash, now);

    expect(await repositories.sessions.findValidByTokenHash(tokenHash, now)).toBeNull();
    const row = await prisma.session.findUnique({ where: { tokenHash } });
    expect(row?.revokedAt).toBeInstanceOf(Date);

    await prisma.session.delete({ where: { tokenHash } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('refuses audit and outbox writes outside a transaction', async () => {
    await expect(
      writeAudit(prisma as never, {
        action: `${marker}.no-transaction`,
        entityType: 'foundation_test',
        entityId: marker,
      }),
    ).rejects.toThrow(/inside withTransaction/);

    await expect(
      emitEvent(prisma as never, {
        eventType: `${marker}.no-transaction`,
        aggregateType: 'foundation_test',
        aggregateId: marker,
        payload: {},
      }),
    ).rejects.toThrow(/inside withTransaction/);
  });
});
