import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import { parseSeedEnv, type SeedEnv } from '@curenear/shared';
import { createPrismaClient } from './src/client';
import { hashPassword } from './src/password';
import { seedReferenceData } from './src/reference-seed';
import { withTransaction, writeAudit } from './src/transactions';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Idempotent bootstrap: creates the first ADMIN so the portal is reachable.
 * The account starts with must_change_password so the seeded password cannot
 * survive first use. Staff accounts are created by admins in the portal.
 */
async function seedAdmin(prisma: PrismaClient, env: SeedEnv): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    process.stdout.write(`seed: admin ${email} already exists, leaving it untouched\n`);
    return;
  }

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  try {
    const user = await withTransaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: env.SEED_ADMIN_NAME,
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          mustChangePassword: true,
        },
        select: { id: true, email: true },
      });

      await writeAudit(tx, {
        actorUserId: null,
        actorRole: null,
        action: 'user.seeded',
        entityType: 'user',
        entityId: created.id,
        changedFieldKeys: ['email', 'name', 'role'],
        reason: 'Bootstrap seed',
      });

      return created;
    }, prisma);

    process.stdout.write(
      `seed: created admin ${user.email} (must change password at first sign-in)\n`,
    );
  } catch (error) {
    // A concurrent seed may have won the race; the unique email is the guard.
    if (isUniqueViolation(error)) {
      process.stdout.write(`seed: admin ${email} already exists, leaving it untouched\n`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const env = parseSeedEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    await seedAdmin(prisma, env);

    const counts = await seedReferenceData(prisma);
    process.stdout.write(
      `seed: reference data ready — ${counts.states} states, ${counts.councils} councils, ` +
        `${counts.specialties} specialties, ${counts.serviceCategories} service categories, ` +
        `${counts.facilityTypes} facility types, ${counts.licenceTypes} licence types, ` +
        `${counts.documentTypes} document types\n`,
    );
    process.stdout.write(
      'seed: PIN codes are not seeded — import the official directory with pnpm import:pincodes <csv>\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
