import { createPersistenceFromEnv, rebuildProviderPinStats } from '@curenear/db';

/**
 * `pnpm db:rebuild-stats`
 *
 * Recomputes `provider_pin_stats` and its contribution ledger from the live
 * provider tables. Use after seeding, after a manual data fix, or to repair
 * drift reported by the nightly consistency check.
 */
async function main(): Promise<void> {
  const { db } = createPersistenceFromEnv();
  try {
    const result = await rebuildProviderPinStats(db);
    console.warn(
      `PIN stats rebuilt: ${result.statsRows} rows, ${result.contributions} contributions.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('PIN stats rebuild failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
