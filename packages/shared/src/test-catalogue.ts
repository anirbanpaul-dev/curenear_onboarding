import { fieldByKey } from './fields/registry';
import { parseRepeaterItem } from './fields/schema';
import type { TypeDataIssue } from './fields/schema';
import { isPrenatalTest, isSexDeterminationTest } from './test-blocklist';

/**
 * Bulk test-catalogue import (docs/field-spec.md 8.3).
 *
 * The CSV is parsed and every row is validated against the registry's
 * `dc_tests` repeater, so the template, the per-row report and the repeater form
 * cannot drift apart. Rows naming a sex-determination test are blocked outright
 * (Diagnostic cl. 6); prenatal items are accepted but flagged for admin review.
 */

export interface TestCatalogueColumn {
  key: string;
  label: string;
  type: string;
  required: boolean;
}

const catalogueField = () => fieldByKey('diagnostic_centre', 'dc_tests');

export function testCatalogueColumns(): TestCatalogueColumn[] {
  const field = catalogueField();
  return (field?.items ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    type: item.type,
    required: item.requirement === 'required',
  }));
}

/** The downloadable template: header row plus one example row. */
export function testCatalogueTemplateCsv(): string {
  const columns = testCatalogueColumns();
  const example: Record<string, string> = {
    test_name: 'Complete blood count',
    test_code: 'CBC-001',
    test_category: 'pathology',
    test_price: '350',
    test_sample: 'blood',
    test_prep: 'No fasting required',
    test_tat: '24 hours',
    test_rx_required: 'yes',
    test_performed_at: 'on site',
    test_perf_lab: '',
    test_home: 'yes',
  };
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const header = columns.map((column) => escape(column.label)).join(',');
  const row = columns.map((column) => escape(example[column.key] ?? '')).join(',');
  return `${header}\n${row}\n`;
}

/** Minimal RFC 4180 parser: quoted cells, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);

  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeName = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function coerceValue(type: string, raw: string): unknown {
  const value = raw.trim();
  if (value === '') return undefined;
  switch (type) {
    case 'boolean': {
      const lowered = value.toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(lowered)) return true;
      if (['no', 'n', 'false', '0'].includes(lowered)) return false;
      return value;
    }
    case 'money':
    case 'number':
      return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    case 'multiselect':
      return value
        .split(/[;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    default:
      return value;
  }
}

export type TestCatalogueRowStatus = 'imported' | 'flagged' | 'invalid' | 'blocked';

export interface TestCatalogueRowResult {
  /** Spreadsheet row number, header included. */
  row: number;
  status: TestCatalogueRowStatus;
  testName: string | null;
  issues: TypeDataIssue[];
  flags: string[];
}

export interface TestCatalogueCounts {
  imported: number;
  flagged: number;
  invalid: number;
  blocked: number;
}

export interface TestCatalogueImportReport {
  rows: TestCatalogueRowResult[];
  /** Rows that may be stored (imported and flagged). */
  tests: Array<Record<string, unknown>>;
  counts: TestCatalogueCounts;
  headerIssues: TypeDataIssue[];
}

export interface TestCatalogueImportInput {
  csv: string;
  /** Values of the section the catalogue sits in (`dc_home_collection`, ...). */
  context?: Record<string, unknown>;
  /** Tests already stored for this provider, to reject duplicates. */
  existing?: ReadonlyArray<Record<string, unknown>>;
  maxRows?: number;
}

const MAX_ROWS = 500;

export function importTestCatalogueCsv(input: TestCatalogueImportInput): TestCatalogueImportReport {
  const columns = testCatalogueColumns();
  const byHeader = new Map<string, TestCatalogueColumn>();
  for (const column of columns) {
    byHeader.set(normalizeHeader(column.key), column);
    byHeader.set(normalizeHeader(column.label), column);
  }

  const table = parseCsv(input.csv);
  const headerIssues: TypeDataIssue[] = [];
  const empty: TestCatalogueImportReport = {
    rows: [],
    tests: [],
    counts: { imported: 0, flagged: 0, invalid: 0, blocked: 0 },
    headerIssues,
  };
  if (table.length === 0) {
    headerIssues.push({ path: 'csv', message: 'The file is empty' });
    return empty;
  }

  const header = table[0] ?? [];
  const mapped = header.map((cell) => byHeader.get(normalizeHeader(cell)) ?? null);
  const seen = new Set(
    mapped
      .filter((entry): entry is TestCatalogueColumn => entry !== null)
      .map((entry) => entry.key),
  );
  for (const column of columns) {
    if (column.required && !seen.has(column.key)) {
      headerIssues.push({ path: column.key, message: `Missing required column: ${column.label}` });
    }
  }
  if (headerIssues.length > 0) return { ...empty, headerIssues };
  if (table.length - 1 > (input.maxRows ?? MAX_ROWS)) {
    headerIssues.push({
      path: 'csv',
      message: `Import up to ${input.maxRows ?? MAX_ROWS} rows at a time`,
    });
    return { ...empty, headerIssues };
  }

  const existingNames = new Set(
    (input.existing ?? []).map((row) => normalizeName(row.test_name)).filter(Boolean),
  );
  const existingCodes = new Set(
    (input.existing ?? []).map((row) => normalizeName(row.test_code)).filter(Boolean),
  );
  const fileNames = new Set<string>();
  const fileCodes = new Set<string>();

  const rows: TestCatalogueRowResult[] = [];
  const tests: Array<Record<string, unknown>> = [];
  const counts: TestCatalogueCounts = { imported: 0, flagged: 0, invalid: 0, blocked: 0 };

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? [];
    const raw: Record<string, unknown> = {};
    mapped.forEach((column, cellIndex) => {
      if (!column) return;
      const value = coerceValue(column.type ?? 'text', cells[cellIndex] ?? '');
      if (value !== undefined) raw[column.key] = value;
    });

    const testName = typeof raw.test_name === 'string' ? raw.test_name : null;
    const testCode = typeof raw.test_code === 'string' ? raw.test_code : null;
    const label = testName ?? testCode ?? `row ${index + 1}`;

    if (testName && isSexDeterminationTest(testName)) {
      counts.blocked += 1;
      rows.push({
        row: index + 1,
        status: 'blocked',
        testName,
        issues: [
          {
            path: 'test_name',
            message: 'Sex-determination tests cannot be listed (Diagnostic cl. 6, PC-PNDT Act)',
          },
        ],
        flags: [],
      });
      continue;
    }
    if (testCode && isSexDeterminationTest(testCode)) {
      counts.blocked += 1;
      rows.push({
        row: index + 1,
        status: 'blocked',
        testName: label,
        issues: [
          {
            path: 'test_code',
            message: 'Sex-determination tests cannot be listed (Diagnostic cl. 6, PC-PNDT Act)',
          },
        ],
        flags: [],
      });
      continue;
    }

    const issues: TypeDataIssue[] = [];
    const nameKey = normalizeName(raw.test_name);
    const codeKey = normalizeName(raw.test_code);
    if (nameKey && (existingNames.has(nameKey) || fileNames.has(nameKey))) {
      issues.push({ path: 'test_name', message: 'This test is already in the catalogue' });
    }
    if (codeKey && (existingCodes.has(codeKey) || fileCodes.has(codeKey))) {
      issues.push({ path: 'test_code', message: 'This test code is already used' });
    }
    const parsed = parseRepeaterItem('diagnostic_centre', 'dc_tests', raw, input.context ?? {});
    issues.push(...parsed.issues);

    if (issues.length > 0) {
      counts.invalid += 1;
      rows.push({ row: index + 1, status: 'invalid', testName: label, issues, flags: [] });
      continue;
    }

    if (nameKey) fileNames.add(nameKey);
    if (codeKey) fileCodes.add(codeKey);
    tests.push(parsed.value);

    const flags = isPrenatalTest(
      testName ?? '',
      typeof raw.test_category === 'string' ? raw.test_category : null,
    )
      ? ['Prenatal test: flagged for admin review']
      : [];
    if (flags.length > 0) {
      counts.flagged += 1;
      rows.push({ row: index + 1, status: 'flagged', testName: label, issues: [], flags });
    } else {
      counts.imported += 1;
      rows.push({ row: index + 1, status: 'imported', testName: label, issues: [], flags });
    }
  }

  return { rows, tests, counts, headerIssues };
}
