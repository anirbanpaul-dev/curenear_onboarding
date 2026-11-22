import { Prisma } from '@prisma/client';
import type { ProviderType } from '@prisma/client';
import type { DbClient } from '../client';

/**
 * Provider identifiers.
 *
 * `nextProviderCode` is the only way provider codes are generated: the per-type
 * sequences and the prefixes live in the database (migration
 * 20260301000000_provider_data_model), so two app instances cannot hand out the
 * same code.
 *
 * The PIN read model lives in `pin-stats.ts`.
 */

/** CN-PH-000123 for the next pharmacy, and so on per provider type. */
export async function nextProviderCode(db: DbClient, providerType: ProviderType): Promise<string> {
  const rows = await db.$queryRaw<Array<{ code: string }>>(
    Prisma.sql`SELECT next_provider_code(${providerType}::"ProviderType") AS code`,
  );
  const code = rows[0]?.code;
  if (!code) throw new Error(`Could not generate a provider code for ${providerType}`);
  return code;
}
