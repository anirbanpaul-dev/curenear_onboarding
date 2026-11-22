import { describe, expect, it } from 'vitest';
import {
  csvBom,
  csvChunks,
  csvRowLine,
  escapeCsvCell,
  exportColumnMaps,
  exportTypes,
  type ExportRow,
} from './exports';

describe('CSV formula injection', () => {
  it('prefixes cells that a spreadsheet would execute', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
  });

  it('looks past leading whitespace and still quotes the cell', () => {
    expect(escapeCsvCell('  =HYPERLINK("http://evil","x")')).toBe(
      '"\'  =HYPERLINK(""http://evil"",""x"")"',
    );
  });

  it('leaves ordinary text alone and escapes quotes, commas and newlines', () => {
    expect(escapeCsvCell('Apollo Clinic')).toBe('Apollo Clinic');
    expect(escapeCsvCell('Clinic, Inc')).toBe('"Clinic, Inc"');
    expect(escapeCsvCell('a "quoted" name')).toBe('"a ""quoted"" name"');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvCell(null)).toBe('');
  });

  it('escapes every value in a row through the column map', () => {
    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'note', header: 'Note' },
    ];
    expect(csvRowLine(columns, { name: '=cmd|calc', note: 'safe' })).toBe("'=cmd|calc,safe");
  });
});

describe('CSV streaming', () => {
  it('opens with a BOM, writes one header and streams rows in chunks', async () => {
    const columns = [
      { key: 'code', header: 'Code' },
      { key: 'count', header: 'Count' },
    ];
    const total = 50_000;

    async function* rows(): AsyncIterable<ExportRow> {
      for (let index = 0; index < total; index += 1) {
        yield { code: `P-${index}`, count: index };
      }
    }

    const chunks: string[] = [];
    let maxChunk = 0;
    for await (const chunk of csvChunks(columns, rows(), 500)) {
      chunks.push(chunk);
      maxChunk = Math.max(maxChunk, chunk.length);
    }

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startsWith(`${csvBom}Code,Count`)).toBe(true);
    // No chunk ever holds the whole file: 50k rows would be several hundred KB.
    expect(maxChunk).toBeLessThan(100_000);

    const text = chunks.join('');
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(total + 1);
    expect(lines[1]).toBe('P-0,0');
    expect(lines.at(-1)).toBe(`P-${total - 1},${total - 1}`);
  });

  it('writes the header even when the filter matches nothing', async () => {
    const chunks: string[] = [];
    for await (const chunk of csvChunks([{ key: 'code', header: 'Code' }], [])) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe(`${csvBom}Code\r\n`);
  });
});

describe('export column maps', () => {
  it('never exposes documents or consent evidence', () => {
    for (const type of exportTypes) {
      const keys = exportColumnMaps[type].map((column) => column.key).join(' ');
      expect(keys).not.toMatch(/document_(file|storage|binary)|consent|declaration|evidence/i);
      expect(exportColumnMaps[type].length).toBeGreaterThan(0);
    }
  });
});
