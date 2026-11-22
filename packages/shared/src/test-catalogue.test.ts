import { describe, expect, it } from 'vitest';
import {
  importTestCatalogueCsv,
  parseCsv,
  testCatalogueColumns,
  testCatalogueTemplateCsv,
} from './test-catalogue';

/**
 * Bulk catalogue import (field-spec 8.3): good rows import, bad rows are
 * reported line by line, and malicious rows (sex-determination tests, formula
 * payloads) never reach the catalogue.
 */

const columns = testCatalogueColumns();

function toCsv(rows: Array<Record<string, string>>): string {
  const header = columns.map((column) => column.label).join(',');
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = row[column.key] ?? '';
        return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      })
      .join(','),
  );
  return [header, ...body].join('\n');
}

const goodRow: Record<string, string> = {
  test_name: 'Complete blood count',
  test_code: 'CBC-001',
  test_category: 'pathology',
  test_price: '350',
  test_sample: 'blood',
  test_prep: 'No fasting required',
  test_tat: '24 hours',
  test_rx_required: 'yes',
  test_performed_at: 'on site',
};

describe('test catalogue CSV (field-spec 8.3)', () => {
  it('ships a template with one header row and an example', () => {
    const table = parseCsv(testCatalogueTemplateCsv());
    expect(table).toHaveLength(2);
    expect(table[0]).toHaveLength(columns.length);
    expect(table[0]?.[0]).toBe(columns[0]?.label);
    for (const column of columns) expect(table[0]).toContain(column.label);
  });

  it('imports a good row and converts the price to paise', () => {
    const report = importTestCatalogueCsv({ csv: toCsv([goodRow]) });
    expect(report.headerIssues).toEqual([]);
    expect(report.counts).toEqual({ imported: 1, flagged: 0, invalid: 0, blocked: 0 });
    expect(report.tests).toHaveLength(1);
    expect(report.tests[0]?.test_price).toBe(35_000);
    expect(report.tests[0]?.test_rx_required).toBe(true);
    expect(report.rows[0]).toMatchObject({ row: 2, status: 'imported' });
  });

  it('reports each bad row without dropping the good ones', () => {
    const report = importTestCatalogueCsv({
      csv: toCsv([
        goodRow,
        { ...goodRow, test_name: '', test_code: 'EMPTY' },
        {
          ...goodRow,
          test_name: 'Unknown category',
          test_code: 'BAD-1',
          test_category: 'nonsense',
        },
        { ...goodRow, test_name: 'Missing prep', test_code: 'BAD-2', test_prep: '' },
      ]),
    });
    expect(report.counts.imported).toBe(1);
    expect(report.counts.invalid).toBe(3);
    expect(report.tests).toHaveLength(1);
    const invalid = report.rows.filter((row) => row.status === 'invalid');
    expect(invalid.map((row) => row.row)).toEqual([3, 4, 5]);
    expect(invalid[0]?.issues.some((issue) => issue.path === 'test_name')).toBe(true);
    expect(invalid[1]?.issues.some((issue) => issue.path === 'test_category')).toBe(true);
    expect(invalid[2]?.issues.some((issue) => issue.path === 'test_prep')).toBe(true);
  });

  it('blocks sex-determination tests by name and by code', () => {
    const report = importTestCatalogueCsv({
      csv: toCsv([
        { ...goodRow, test_name: 'Sex determination by ultrasound', test_code: 'SD-1' },
        { ...goodRow, test_name: 'Gender determination test', test_code: 'SD-2' },
        { ...goodRow, test_name: 'Antenatal profile', test_code: 'SEXDET' },
        { ...goodRow, test_name: 'Fetal sex reveal package', test_code: 'SD-3' },
      ]),
    });
    expect(report.counts.blocked).toBe(4);
    expect(report.counts.imported).toBe(0);
    expect(report.tests).toHaveLength(0);
    for (const row of report.rows) {
      expect(row.status).toBe('blocked');
      expect(row.issues[0]?.message).toContain('Sex-determination');
    }
  });

  it('flags prenatal tests for admin review but still imports them', () => {
    const report = importTestCatalogueCsv({
      csv: toCsv([
        {
          ...goodRow,
          test_name: 'Prenatal anomaly scan',
          test_code: 'PN-1',
          test_category: 'prenatal',
          test_sample: 'imaging',
        },
      ]),
    });
    expect(report.counts.flagged).toBe(1);
    expect(report.tests).toHaveLength(1);
    expect(report.rows[0]?.status).toBe('flagged');
    expect(report.rows[0]?.flags[0]).toContain('admin review');
  });

  it('rejects duplicates already in the catalogue and inside the file', () => {
    const report = importTestCatalogueCsv({
      csv: toCsv([
        { ...goodRow, test_name: 'Lipid profile', test_code: 'LP-1' },
        { ...goodRow, test_name: 'Lipid profile', test_code: 'LP-2' },
        { ...goodRow, test_name: 'Existing test', test_code: 'EX-1' },
      ]),
      existing: [{ test_name: 'Existing test', test_code: 'EX-9' }],
    });
    expect(report.counts.imported).toBe(1);
    expect(report.counts.invalid).toBe(2);
    expect(report.rows[1]?.issues.some((issue) => issue.path === 'test_name')).toBe(true);
    expect(report.rows[2]?.issues.some((issue) => issue.path === 'test_name')).toBe(true);
  });

  it('rejects a file whose header is missing a required column', () => {
    const header = columns.map((column) => column.label);
    const withoutPrep = header.filter((label) => label !== 'Preparation requirements').join(',');
    const report = importTestCatalogueCsv({
      csv: `${withoutPrep}\n${columns
        .map((column) => (column.key === 'test_prep' ? '' : (goodRow[column.key] ?? '')))
        .filter((_, index) => columns[index]?.key !== 'test_prep')
        .join(',')}\n`,
    });
    expect(report.headerIssues.some((issue) => issue.message.includes('Preparation'))).toBe(true);
    expect(report.tests).toHaveLength(0);
  });

  it('treats formula and markup payloads as plain text', () => {
    const report = importTestCatalogueCsv({
      csv: toCsv([
        {
          ...goodRow,
          test_name: '=HYPERLINK("http://evil.example","CBC")',
          test_code: '<script>alert(1)</script>',
          test_prep: 'Prepare, fast for 8 hours; avoid alcohol',
        },
      ]),
    });
    expect(report.counts.invalid + report.counts.imported + report.counts.flagged).toBe(1);
    const stored = report.tests[0] ?? {};
    expect(stored.test_name).toBe('=HYPERLINK("http://evil.example","CBC")');
    expect(stored.test_code).toBe('<script>alert(1)</script>');
    expect(stored.test_prep).toBe('Prepare, fast for 8 hours; avoid alcohol');
  });

  it('parses quoted cells, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"one, two","he said ""hi"""\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['one, two', 'he said "hi"'],
    ]);
  });
});
