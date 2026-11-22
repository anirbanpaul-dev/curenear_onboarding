import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createPrismaClient,
  importPincodes,
  indiaPostPincodeMapping,
  type PincodeCsvMapping,
} from '../packages/db/src/index';

/**
 * Import the official India Post PIN code directory (data.gov.in).
 *
 *   pnpm import:pincodes data/all_india_pin_code.csv
 *   pnpm import:pincodes data/all_india_pin_code.csv --dry-run
 *   pnpm import:pincodes other.csv --mapping scripts/other.mapping.json
 *
 * See docs/pincode-import.md for where to download the CSV. Nothing in this
 * script invents data: rows that cannot be matched to a seeded state are
 * skipped and reported.
 */

interface CliOptions {
  csvPath: string;
  /** Optional override; the India Post mapping is built in. */
  mappingPath: string | null;
  dryRun: boolean;
  batchSize: number;
}

function usage(): never {
  process.stderr.write(
    [
      'usage: pnpm import:pincodes <csv file> [--mapping <file>] [--dry-run] [--batch-size <n>]',
      '',
      '  --mapping     column mapping JSON; defaults to the built-in India Post mapping',
      '  --dry-run     read and validate the file, write nothing',
      '  --batch-size  rows per database batch (default 500)',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    csvPath: '',
    mappingPath: null,
    dryRun: false,
    batchSize: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--mapping') {
      options.mappingPath = argv[++index] ?? '';
      if (!options.mappingPath) usage();
    } else if (arg === '--batch-size') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) usage();
      options.batchSize = value;
    } else if (arg.startsWith('--')) {
      usage();
    } else if (!options.csvPath) {
      options.csvPath = arg;
    } else {
      usage();
    }
  }

  if (!options.csvPath) usage();
  return options;
}

/** Reads KEY=VALUE pairs from the repo's .env without a dependency. */
function loadEnvFile(filePath: string): void {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  // pnpm runs the script from packages/db, so relative paths are resolved
  // against the directory the developer invoked the command from.
  const invocationDir = process.env.INIT_CWD ?? repoRoot;
  const options = parseArgs(process.argv.slice(2));

  loadEnvFile(path.join(repoRoot, '.env'));
  if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is not set; add it to .env or export it.\n');
    process.exit(1);
  }

  const csvPath = path.resolve(invocationDir, options.csvPath);
  const mappingPath = options.mappingPath ? path.resolve(invocationDir, options.mappingPath) : null;
  const mapping = mappingPath
    ? (JSON.parse(readFileSync(mappingPath, 'utf8')) as PincodeCsvMapping)
    : indiaPostPincodeMapping;

  process.stdout.write(`importing ${csvPath}\n`);
  process.stdout.write(`mapping   ${mappingPath ?? 'built-in India Post columns'}\n`);
  if (options.dryRun) process.stdout.write('dry run: no writes\n');

  const csvText = readFileSync(csvPath, 'utf8');
  const prisma = createPrismaClient(process.env.DATABASE_URL);

  try {
    const result = await importPincodes(prisma, {
      mapping,
      csvText,
      dryRun: options.dryRun,
      batchSize: options.batchSize,
      log: (message) => process.stdout.write(`${message}\n`),
    });

    process.stdout.write(
      [
        '',
        `rows read      ${result.rowsRead}`,
        `unique PINs    ${result.uniquePins}`,
        `added          ${result.added}`,
        `updated        ${result.updated}`,
        `skipped        ${result.skipped}`,
        `unchanged      ${result.unchanged}`,
        `districts new  ${result.districtsCreated}`,
        `states matched ${result.statesMatched}`,
        `took           ${(result.durationMs / 1000).toFixed(1)}s`,
        '',
      ].join('\n'),
    );

    const reasons = Object.entries(result.skippedReasons);
    if (reasons.length > 0) {
      process.stdout.write('skip reasons:\n');
      for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${reason.padEnd(26)} ${count}\n`);
      }
      process.stdout.write('\n');
    }

    if (result.unknownStates.length > 0) {
      process.stdout.write(
        `states with no seeded match (rows skipped): ${result.unknownStates.join(', ')}\n`,
      );
      process.stdout.write(
        'Add those states to the seed (packages/db/src/reference-data.ts) and rerun.\n',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `pincode import failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
