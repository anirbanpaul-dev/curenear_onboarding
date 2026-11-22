/**
 * Next.js calls `register` once per server process. Validating here makes a
 * misconfigured deployment fail at boot with every offending variable listed,
 * instead of at the first request that happens to need one.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getServerEnv } = await import('@curenear/shared');
  getServerEnv();
}
