import { createPrismaClient } from '@curenear/db';
import { checkStorage } from './storage';

export type DependencyState = 'ok' | 'unavailable';

export interface ReadinessReport {
  ok: boolean;
  checks: { database: DependencyState; storage: DependencyState };
}

let client: ReturnType<typeof createPrismaClient> | null = null;

async function checkDatabase(timeoutMs = 3000): Promise<void> {
  client ??= createPrismaClient();
  await Promise.race([
    client.$queryRaw`select 1`,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function state(check: () => Promise<void>): Promise<DependencyState> {
  try {
    await check();
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/** Both dependencies must answer for the instance to take traffic. */
export async function runReadinessChecks(): Promise<ReadinessReport> {
  const [database, storage] = await Promise.all([
    state(() => checkDatabase()),
    state(() => checkStorage()),
  ]);
  return { ok: database === 'ok' && storage === 'ok', checks: { database, storage } };
}
