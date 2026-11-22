import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { parseSeedEnv, parseServerEnv } from '@curenear/shared';

/**
 * Validate an env file without starting the app.
 *
 *   pnpm check:env                      # .env
 *   pnpm check:env -- .env.production   # explicit file
 *   pnpm check:env -- .env --seed       # also require SEED_ADMIN_* values
 *
 * Placeholders such as CHANGE_ME or <generate-with-openssl> fail the same way
 * they would at boot. Exit code 1 means the file is not usable.
 */

const args = process.argv.slice(2);
const fileArg = args.find((arg) => !arg.startsWith('--')) ?? '.env';
const checkSeed = args.includes('--seed');
const envPath = resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);

let parsed: Record<string, string>;
try {
  parsed = parseDotenv(readFileSync(envPath));
} catch (error) {
  process.stderr.write(
    `Cannot read ${envPath}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

try {
  const env = parseServerEnv(parsed as NodeJS.ProcessEnv);
  if (checkSeed) parseSeedEnv(parsed as NodeJS.ProcessEnv);
  process.stdout.write(
    [
      `OK ${envPath}`,
      `  NODE_ENV=${env.NODE_ENV}`,
      `  APP_URL=${env.APP_URL}`,
      `  database=${new URL(env.DATABASE_URL).host}`,
      `  storage=${env.S3_ENDPOINT} (${env.S3_BUCKET})`,
      `  smtp=${env.SMTP_HOST}:${env.SMTP_PORT}`,
      checkSeed ? '  seed admin=present' : '',
      '',
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
