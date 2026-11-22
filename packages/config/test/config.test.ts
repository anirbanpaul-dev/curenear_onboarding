import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createEslintConfig } from '../eslint/index.mjs';

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')) as Record<
    string,
    unknown
  >;

describe('shared config package', () => {
  it('keeps TypeScript strict in the base preset', () => {
    const base = readJson('../tsconfig/base.json') as {
      compilerOptions: Record<string, unknown>;
    };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noImplicitOverride).toBe(true);
  });

  it('extends the base preset from the node preset', () => {
    const node = readJson('../tsconfig/node.json') as { extends: string };
    expect(node.extends).toBe('./base.json');
  });

  it('returns a flat config with ignores first', () => {
    const config = createEslintConfig({ react: true });
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(2);
    expect(config[0]).toHaveProperty('ignores');
    expect(
      config.some((entry) => Boolean(entry && typeof entry === 'object' && 'plugins' in entry)),
    ).toBe(true);
  });
});

describe('github actions workflow', () => {
  const workflow = parseYaml(
    readFileSync(
      fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)),
      'utf8',
    ),
  ) as {
    jobs: Record<
      string,
      {
        'runs-on': string;
        services?: Record<string, { image: string }>;
        env?: Record<string, string>;
        steps: Array<{ run?: string; uses?: string }>;
      }
    >;
  };

  it('runs lint, typecheck, tests and build on ubuntu', () => {
    const job = workflow.jobs.quality;
    expect(job).toBeDefined();
    expect(job?.['runs-on']).toBe('ubuntu-latest');

    const commands = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');
    for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
      expect(commands).toContain(command);
    }
  });

  it('provides a migrated PostgreSQL service and database url', () => {
    const job = workflow.jobs.quality;
    expect(job?.services?.postgres.image).toContain('postgres');
    expect(job?.env?.DATABASE_URL).toContain('postgresql://');

    const commands = (job?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(commands).toContain('pnpm db:migrate');
  });
});

describe('deployment manifests', () => {
  for (const relativePath of [
    '../../../render.yaml',
    '../../../docker-compose.prod.yml',
    '../../../.github/workflows/migrate.yml',
  ]) {
    it(`parses ${relativePath.split('/').pop()}`, () => {
      const document = parseYaml(
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
      ) as Record<string, unknown>;
      expect(document).toBeTruthy();
    });
  }
});
