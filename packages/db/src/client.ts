import { PrismaClient } from '@prisma/client';
import { getServerEnv } from '@curenear/shared';

/**
 * Structural type shared by PrismaClient and Prisma.TransactionClient so every
 * repository can run either standalone or inside a transaction.
 */
export type DbClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

let cached: PrismaClient | null = null;

// `next dev` re-evaluates modules on every edit; a module-local client would leak
// a connection pool per reload until PostgreSQL refuses new connections.
const globalForPrisma = globalThis as typeof globalThis & {
  __curenearPrisma?: PrismaClient;
};

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl ?? getServerEnv().DATABASE_URL;
  return new PrismaClient({
    datasources: { db: { url } },
    log: ['warn', 'error'],
  });
}

/** Lazily created so imports never require DATABASE_URL at build time. */
export function getPrismaClient(): PrismaClient {
  if (!cached) {
    if (process.env.NODE_ENV === 'production') {
      cached = createPrismaClient();
    } else {
      globalForPrisma.__curenearPrisma ??= createPrismaClient();
      cached = globalForPrisma.__curenearPrisma;
    }
  }
  return cached;
}

export async function disconnectPrisma(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = null;
    globalForPrisma.__curenearPrisma = undefined;
  }
}
