import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@curenear/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPersistence, createPrismaClient } from '@curenear/db';

/**
 * Real-infrastructure suite: PostgreSQL and MinIO run in containers, the
 * production migrations are applied, and the assertions use the actual
 * repositories and S3 API. Docker is not present on every developer machine,
 * so the suite skips (loudly) and CI runs it on ubuntu-latest.
 */
const dockerReady = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

if (!dockerReady) {
  console.warn('[testcontainers] Docker is unavailable; real PostgreSQL/MinIO suite skipped.');
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe.skipIf(!dockerReady)('real PostgreSQL and MinIO', () => {
  let postgres: StartedPostgreSqlContainer;
  let minio: StartedTestContainer;
  let db: PrismaClient;
  let repositories: ReturnType<typeof createPersistence>['repositories'];
  let unitOfWork: ReturnType<typeof createPersistence>['unitOfWork'];
  let s3: S3Client;
  let bucket: string;

  const suffix = randomUUID().slice(0, 8);
  const staffA = randomUUID();
  const staffB = randomUUID();
  const mobile = '9876500001';
  const pin = '700091';

  beforeAll(async () => {
    [postgres, minio] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('curenear')
        .withUsername('curenear')
        .withPassword('curenear')
        .start(),
      new GenericContainer('minio/minio:latest')
        .withCommand(['server', '/data'])
        .withEnvironment({
          MINIO_ROOT_USER: 'curenear',
          MINIO_ROOT_PASSWORD: 'curenear-secret',
        })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000).withStartupTimeout(120_000))
        .start(),
    ]);

    execFileSync('pnpm', ['--filter', '@curenear/db', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: postgres.getConnectionUri() },
      stdio: 'pipe',
      timeout: 180_000,
    });

    db = createPrismaClient(postgres.getConnectionUri());
    ({ repositories, unitOfWork } = createPersistence(db));

    s3 = new S3Client({
      endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'curenear', secretAccessKey: 'curenear-secret' },
    });
    bucket = `curenear-test-${suffix}`;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));

    await db.user.createMany({
      data: [
        {
          id: staffA,
          email: `staff-a-${suffix}@test.local`,
          name: 'Staff A',
          passwordHash: 'x',
          role: 'STAFF',
        },
        {
          id: staffB,
          email: `staff-b-${suffix}@test.local`,
          name: 'Staff B',
          passwordHash: 'x',
          role: 'STAFF',
        },
      ],
    });
  }, 240_000);

  afterAll(async () => {
    await db?.$disconnect().catch(() => undefined);
    await Promise.allSettled([postgres?.stop(), minio?.stop()]);
  }, 120_000);

  it('rolls back every write in a failed transaction', async () => {
    const email = `rollback-${suffix}@test.local`;

    await expect(
      unitOfWork.transaction(async (tx) => {
        await tx.users.create({
          id: randomUUID(),
          email,
          name: 'Rolled Back',
          passwordHash: 'x',
          role: 'STAFF',
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('claims outbox rows atomically and stops after publishing', async () => {
    const id = randomUUID();
    await repositories.outbox.append({
      id,
      eventType: 'provider.submitted',
      eventVersion: 1,
      aggregateType: 'provider_organization',
      aggregateId: randomUUID(),
      payload: { organizationId: randomUUID() },
      occurredAt: new Date('2026-11-22T09:00:00.000Z'),
    });

    const now = new Date('2026-11-22T10:00:00.000Z');
    const first = await repositories.outbox.claimBatch(10, now);
    expect(first.map((row) => row.id)).toContain(id);
    expect(first.find((row) => row.id === id)?.attempts).toBe(1);

    const second = await repositories.outbox.claimBatch(10, now);
    expect(second.find((row) => row.id === id)?.attempts).toBe(2);

    await repositories.outbox.markPublished(id, now);
    const third = await repositories.outbox.claimBatch(10, now);
    expect(third.map((row) => row.id)).not.toContain(id);
  });

  it('enforces append-only audit logs in the database', async () => {
    const audit = await db.auditLog.create({
      data: {
        actorUserId: staffA,
        actorRole: 'STAFF',
        action: 'test.append',
        entityType: 'provider_organization',
        entityId: randomUUID(),
        changedFieldKeys: [],
      },
    });

    await expect(
      db.$executeRawUnsafe(
        `UPDATE audit_logs SET action = 'test.tampered' WHERE id = '${audit.id}'`,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = '${audit.id}'`),
    ).rejects.toThrow(/append-only/i);

    expect(await db.auditLog.findUnique({ where: { id: audit.id } })).toMatchObject({
      action: 'test.append',
    });
  });

  it('scopes provider reads to the owning staff account', async () => {
    const own = await db.providerOrganization.create({
      data: {
        code: `CN-TC-${suffix}-A`,
        providerType: 'clinic',
        legalName: `CareNear Test Clinic ${suffix}`,
        mobile,
        primaryPinCode: pin,
        createdByUserId: staffA,
      },
    });
    await db.providerOrganization.create({
      data: {
        code: `CN-TC-${suffix}-B`,
        providerType: 'clinic',
        legalName: `Another Test Clinic ${suffix}`,
        mobile,
        primaryPinCode: pin,
        createdByUserId: staffB,
      },
    });

    const ownRows = await repositories.onboarding.findByMobileAndPin(mobile, pin, null, staffA);
    const otherRows = await repositories.onboarding.findByMobileAndPin(mobile, pin, null, staffB);

    expect(ownRows.map((row) => row.id)).toEqual([own.id]);
    expect(otherRows.map((row) => row.id)).not.toContain(own.id);
    expect(
      (await repositories.onboarding.findByMobileAndPin(mobile, pin, null, randomUUID())).length,
    ).toBe(0);
  });

  it('finds near-duplicate legal names in the same PIN', async () => {
    const legalName = `Sunrise Health Centre ${suffix}`;
    const created = await db.providerOrganization.create({
      data: {
        code: `CN-TC-${suffix}-D`,
        providerType: 'clinic',
        legalName,
        primaryPinCode: pin,
        createdByUserId: staffB,
      },
    });

    const candidates = await repositories.onboarding.findSimilarLegalName(
      `Sunrise Health Center ${suffix}`,
      pin,
      null,
      null,
    );
    expect(candidates.map((row) => row.id)).toContain(created.id);
    expect(candidates.find((row) => row.id === created.id)?.similarity).toBeGreaterThanOrEqual(
      0.45,
    );

    const dismissed = await repositories.onboarding.findSimilarLegalName(
      `Sunrise Health Center ${suffix}`,
      pin,
      created.id,
      null,
    );
    expect(dismissed.map((row) => row.id)).not.toContain(created.id);
  });

  it('stores and serves a document through real MinIO', async () => {
    const key = `documents/${suffix}/licence.pdf`;
    const body = Buffer.from('%PDF-1.4 test document');

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }),
    );

    const fetched = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await fetched.Body?.transformToByteArray();
    expect(Buffer.from(bytes ?? []).toString()).toBe(body.toString());

    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 300,
    });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body.toString());

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    expect((await fetch(url)).status).toBe(404);
  });
});
