import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

/**
 * Load test for the two read paths that carry the admin experience:
 * the provider directory and the PIN analytics summary.
 *
 * Seed 100,000 synthetic providers first:
 *   pnpm seed:synthetic-providers -- --count=100000
 * Then run against a started app:
 *   pnpm perf:load
 *
 * Environment:
 *   LOAD_BASE_URL      default http://localhost:3000
 *   LOAD_EMAIL         default e2e-operator@curenear.in
 *   LOAD_PASSWORD      default e2e-operator-password-123
 *   LOAD_CONNECTIONS   default 20
 *   LOAD_DURATION      seconds, default 15
 *   LOAD_PIN           default 700091
 *   LOAD_OUTPUT        default docs/performance.md
 */

const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const email = process.env.LOAD_EMAIL ?? 'e2e-operator@curenear.in';
const password = process.env.LOAD_PASSWORD ?? 'e2e-operator-password-123';
const connections = Number(process.env.LOAD_CONNECTIONS ?? 20);
const duration = Number(process.env.LOAD_DURATION ?? 15);
const pin = process.env.LOAD_PIN ?? '700091';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(repoRoot, process.env.LOAD_OUTPUT ?? 'docs/performance.md');

interface Result {
  name: string;
  url: string;
  requests: number;
  rps: number;
  latencyP50: number;
  latencyP97_5: number;
  latencyP99: number;
  latencyMax: number;
  errors: number;
  non2xx: number;
}

async function adminCookie(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      host: new URL(baseUrl).host,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Login failed (${response.status}): ${await response.text()}`);
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((value) => value.includes('curenear_session='));
  if (!session) throw new Error('Login did not return a session cookie');
  return session.split(';')[0]!;
}

function run(name: string, path: string, cookie: string): Promise<Result> {
  const url = `${baseUrl}${path}`;
  return new Promise((resolveRun, reject) => {
    const instance = autocannon(
      {
        url,
        method: 'GET',
        connections,
        duration,
        headers: { cookie, accept: 'application/json' },
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        const non2xx = result.non2xx ?? 0;
        resolveRun({
          name,
          url,
          requests: result.requests.total,
          rps: result.requests.average,
          latencyP50: result.latency.p50,
          latencyP97_5: result.latency.p97_5,
          latencyP99: result.latency.p99,
          latencyMax: result.latency.max,
          errors: result.errors,
          non2xx,
        });
      },
    );
    instance.on('reqError', () => undefined);
  });
}

function row(result: Result): string {
  const status = result.errors + result.non2xx === 0 ? 'PASS' : 'FAIL';
  return `| ${result.name} | ${result.rps.toLocaleString()} | ${result.latencyP50} ms | ${result.latencyP97_5} ms | ${result.latencyP99} ms | ${result.latencyMax} ms | ${result.non2xx} | ${status} |`;
}

async function main(): Promise<void> {
  const cookie = await adminCookie();
  const scenarios = [
    ['Provider directory (50 rows)', `/api/v1/admin/providers?page=1&pageSize=50&pin=${pin}`],
    ['Provider directory (search)', '/api/v1/admin/providers?page=1&pageSize=50&q=Synthetic'],
    ['PIN summary (read model)', `/api/v1/admin/analytics/pin-summary?q=${pin}&pageSize=50`],
    [
      'PIN summary (live aggregation)',
      '/api/v1/admin/analytics/pin-summary?pageSize=50&createdFrom=2020-01-01',
    ],
  ] as const;

  const results: Result[] = [];
  for (const [name, path] of scenarios) {
    process.stdout.write(`Running ${name}...\n`);
    results.push(await run(name, path, cookie));
  }

  const headers = [
    '| Scenario | Throughput (req/s) | p50 | p97.5 | p99 | max | Non-2xx | Result |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  const table = [...headers, ...results.map(row)].join('\n');

  const markdown = [
    '# Performance',
    '',
    `Generated ${new Date().toISOString()} by \`scripts/load/provider-load.ts\`.`,
    '',
    '## Workload',
    '',
    `- **Dataset:** 100,000 synthetic providers (\`pnpm seed:synthetic-providers -- --count=100000\`).`,
    `- **Tool:** autocannon, ${connections} connections for ${duration} seconds per scenario.`,
    `- **Target:** ${baseUrl}`,
    `- **Authentication:** administrator session (cookie), the same path the portal uses.`,
    '',
    '## Results',
    '',
    table,
    '',
    '## Caveats',
    '',
    '- Synthetic rows have no realistic type_data or document spread; they exercise indexes and joins, not content rendering.',
    '- Numbers include the Next.js dev server unless the run used a production build. Use `pnpm build && pnpm --filter @curenear/web start` for release figures.',
    '- The load generator, database and app shared one machine. Treat these as regression baselines, not absolute capacity.',
    '- Non-2xx counts include any 401/403 caused by a bad cookie; a PASS requires zero errors and zero non-2xx.',
    '',
  ].join('\n');

  writeFileSync(output, markdown);
  process.stdout.write(`\n${table}\n\nWrote ${output}\n`);
  if (results.some((result) => result.errors > 0 || result.non2xx > 0)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
