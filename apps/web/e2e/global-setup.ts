import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrismaClient, hashPassword } from '@curenear/db';

/**
 * The E2E suite needs two known accounts every run: one admin who still owes a
 * password change (the acceptance flow) and one operator who does not, so the
 * onboarding journeys are unaffected by that first change.
 */

export const FORCED_ADMIN_EMAIL = 'e2e-admin@curenear.in';
export const FORCED_ADMIN_PASSWORD = 'e2e-initial-password-123';
export const OPERATOR_EMAIL = 'e2e-operator@curenear.in';
export const OPERATOR_PASSWORD = 'e2e-operator-password-123';

function readEnvFile(path: string): Record<string, string> {
  try {
    const text = readFileSync(path, 'utf8');
    const values: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) {
        values[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
    return values;
  } catch {
    return {};
  }
}

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const local = readEnvFile(resolve(process.cwd(), '.env.local'));
  if (local.DATABASE_URL) return local.DATABASE_URL;
  const dbPackage = readEnvFile(resolve(process.cwd(), '../../packages/db/.env'));
  if (dbPackage.DATABASE_URL) return dbPackage.DATABASE_URL;
  throw new Error('E2E setup needs DATABASE_URL (or apps/web/.env.local)');
}

export default async function globalSetup(): Promise<void> {
  const prisma = createPrismaClient(databaseUrl());

  try {
    const accounts = [
      {
        email: FORCED_ADMIN_EMAIL,
        name: 'E2E Admin (forced change)',
        password: FORCED_ADMIN_PASSWORD,
        mustChangePassword: true,
      },
      {
        email: OPERATOR_EMAIL,
        name: 'E2E Operator',
        password: OPERATOR_PASSWORD,
        mustChangePassword: false,
      },
    ];

    for (const account of accounts) {
      const passwordHash = await hashPassword(account.password);
      const existing = await prisma.user.findUnique({ where: { email: account.email } });

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: account.name,
            role: 'ADMIN',
            status: 'ACTIVE',
            passwordHash,
            mustChangePassword: account.mustChangePassword,
            failedLoginCount: 0,
            lockedUntil: null,
            deletedAt: null,
          },
        });
        await prisma.session.deleteMany({ where: { userId: existing.id } });
      } else {
        await prisma.user.create({
          data: {
            email: account.email,
            name: account.name,
            role: 'ADMIN',
            status: 'ACTIVE',
            passwordHash,
            mustChangePassword: account.mustChangePassword,
          },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
