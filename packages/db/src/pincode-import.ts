import type { PrismaClient } from '@prisma/client';
import { normalizeStateName } from './reference-data';

/**
 * PIN code directory import (India Post, published by data.gov.in).
 *
 *   pnpm import:pincodes data/all_india_pin_code.csv
 *
 * Column names are data, not code: `indiaPostPincodeMapping` below is the
 * default for the official file, and both the CLI (`--mapping`) and the
 * database importer accept any other mapping without a code change. The import
 * is idempotent — running it twice adds nothing the second time and reports
 * the rows as unchanged.
 */

export interface PincodeCsvMapping {
  /** Defaults to ",". */
  delimiter?: string;
  columns: {
    pinCode: string;
    officeName: string;
    district?: string | null;
    state?: string | null;
    latitude?: string | null;
    longitude?: string | null;
  };
  /**
   * A PIN usually has several offices (head office plus sub offices). The first
   * row for a PIN wins unless a later row matches this rule, which is how the
   * delivery office is preferred over a non-delivery one.
   */
  preferredRow?: { column: string; equals: string } | null;
}

/**
 * Column mapping for the official India Post file published on data.gov.in
 * (`all_india_pin_code.csv`). The browser upload always uses this; the CLI can
 * override it with `--mapping <file>` using the same JSON shape.
 */
export const indiaPostPincodeMapping: PincodeCsvMapping = {
  delimiter: ',',
  columns: {
    pinCode: 'pincode',
    officeName: 'officename',
    district: 'Districtname',
    state: 'statename',
    latitude: 'latitude',
    longitude: 'longitude',
  },
  preferredRow: { column: 'Deliverystatus', equals: 'Delivery' },
};

/** The uploaded file is unusable (missing columns, wrong shape). */
export class PincodeCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PincodeCsvError';
  }
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF, leading BOM. */
export function parseCsv(text: string, delimiter = ','): CsvTable {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow = [], ...dataRows] = rows.filter(
    (entry) => entry.length > 1 || (entry[0] ?? '').trim().length > 0,
  );

  return {
    headers: headerRow.map((header) => header.trim()),
    rows: dataRows.map((entry) => entry.map((value) => value.trim())),
  };
}

export interface ImportPincodesOptions {
  mapping: PincodeCsvMapping;
  csvText: string;
  /** Report the counts without touching the database. */
  dryRun?: boolean;
  batchSize?: number;
  log?: (message: string) => void;
}

export interface ImportPincodesResult {
  rowsRead: number;
  uniquePins: number;
  added: number;
  updated: number;
  skipped: number;
  unchanged: number;
  districtsCreated: number;
  statesMatched: number;
  unknownStates: string[];
  skippedReasons: Record<string, number>;
  durationMs: number;
}

interface PendingPin {
  pinCode: string;
  officeName: string;
  districtName: string | null;
  stateName: string;
  latitude: number | null;
  longitude: number | null;
}

function columnIndexes(
  table: CsvTable,
  mapping: PincodeCsvMapping,
): { indexes: Record<string, number>; missingOptional: string[] } {
  const lookup = new Map(table.headers.map((header, index) => [header.toLowerCase(), index]));

  // PIN and office name identify the row; everything else may be absent in a
  // given release (the plain directory CSV has no latitude/longitude).
  const required: Array<[string, string]> = [
    ['pinCode', mapping.columns.pinCode],
    ['officeName', mapping.columns.officeName],
  ];
  const optional: Array<[string, string | null | undefined]> = [
    ['district', mapping.columns.district],
    ['state', mapping.columns.state],
    ['latitude', mapping.columns.latitude],
    ['longitude', mapping.columns.longitude],
    ['preferred', mapping.preferredRow?.column],
  ];

  const indexes: Record<string, number> = {};
  for (const [field, header] of required) {
    const index = lookup.get(header.toLowerCase());
    if (index === undefined) {
      throw new PincodeCsvError(
        `The CSV has no "${header}" column; fix the mapping file or the file.`,
      );
    }
    indexes[field] = index;
  }

  const missingOptional: string[] = [];
  for (const [field, header] of optional) {
    if (!header) continue;
    const index = lookup.get(header.toLowerCase());
    if (index === undefined) {
      missingOptional.push(header);
      continue;
    }
    indexes[field] = index;
  }

  return { indexes, missingOptional };
}

function parseCoordinate(value: string | undefined, max: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > max) return null;
  return parsed;
}

/**
 * Imports the directory. Returns the counts the CLI prints; every write happens
 * in batches so the whole file never sits in one transaction.
 */
export async function importPincodes(
  prisma: PrismaClient,
  options: ImportPincodesOptions,
): Promise<ImportPincodesResult> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const batchSize = options.batchSize ?? 500;
  const table = parseCsv(options.csvText, options.mapping.delimiter ?? ',');
  const { indexes, missingOptional } = columnIndexes(table, options.mapping);
  const preferred = options.mapping.preferredRow ?? null;

  for (const header of missingOptional) {
    log(`warning: the CSV has no "${header}" column; that value stays empty`);
  }

  const skippedReasons: Record<string, number> = {};
  const unknownStates = new Set<string>();
  const pending = new Map<string, PendingPin>();
  const preferredPins = new Set<string>();
  let rowsRead = 0;

  const skip = (reason: string): void => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  for (const row of table.rows) {
    if (row.every((value) => value.length === 0)) continue;
    rowsRead += 1;

    const pinCode = (row[indexes.pinCode ?? -1] ?? '').trim();
    const officeName = (row[indexes.officeName ?? -1] ?? '').trim();
    const stateName = (row[indexes.state ?? -1] ?? '').trim();

    // Indian PIN codes are six digits and never start with 0.
    if (!/^[1-9]\d{5}$/.test(pinCode)) {
      skip('invalid-pin');
      continue;
    }
    if (officeName.length === 0) {
      skip('missing-office-name');
      continue;
    }
    if (stateName.length === 0) {
      skip('missing-state');
      continue;
    }

    const districtName = (row[indexes.district ?? -1] ?? '').trim() || null;
    const candidate: PendingPin = {
      pinCode,
      officeName,
      districtName,
      stateName,
      latitude: parseCoordinate(row[indexes.latitude ?? -1], 90),
      longitude: parseCoordinate(row[indexes.longitude ?? -1], 180),
    };

    const isPreferred =
      preferred !== null &&
      (row[indexes.preferred ?? -1] ?? '').toLowerCase() === preferred.equals.toLowerCase();

    if (!pending.has(pinCode)) {
      pending.set(pinCode, candidate);
      if (isPreferred) preferredPins.add(pinCode);
    } else if (isPreferred && !preferredPins.has(pinCode)) {
      // Same PIN, delivery office instead of a sub office.
      pending.set(pinCode, candidate);
      preferredPins.add(pinCode);
    } else {
      skip('duplicate-pin-in-file');
    }
  }

  const states = await prisma.state.findMany({ select: { id: true, name: true } });
  const stateIdByName = new Map(states.map((state) => [normalizeStateName(state.name), state.id]));

  const districts = await prisma.district.findMany({
    select: { id: true, stateId: true, name: true },
  });
  const districtKey = (stateId: string, name: string): string => `${stateId}:${name.toLowerCase()}`;
  const districtIdByKey = new Map(
    districts.map((district) => [districtKey(district.stateId, district.name), district.id]),
  );

  const byState = new Map<string, PendingPin[]>();
  for (const entry of pending.values()) {
    const stateId = stateIdByName.get(normalizeStateName(entry.stateName));
    if (!stateId) {
      unknownStates.add(entry.stateName);
      skip('unknown-state');
      continue;
    }
    const list = byState.get(stateId) ?? [];
    list.push(entry);
    byState.set(stateId, list);
  }

  const result: ImportPincodesResult = {
    rowsRead,
    uniquePins: pending.size,
    added: 0,
    updated: 0,
    skipped: 0,
    unchanged: 0,
    districtsCreated: 0,
    statesMatched: byState.size,
    unknownStates: [...unknownStates].sort(),
    skippedReasons,
    durationMs: 0,
  };

  // Districts are created before the PIN rows that point at them.
  const missingDistricts: Array<{ stateId: string; name: string }> = [];
  for (const [stateId, entries] of byState) {
    for (const entry of entries) {
      if (!entry.districtName) continue;
      const key = districtKey(stateId, entry.districtName);
      if (districtIdByKey.has(key)) continue;
      const existing = missingDistricts.find(
        (district) => district.stateId === stateId && district.name === entry.districtName,
      );
      if (existing) continue;
      missingDistricts.push({ stateId, name: entry.districtName });
    }
  }

  if (!options.dryRun && missingDistricts.length > 0) {
    for (let start = 0; start < missingDistricts.length; start += batchSize) {
      const slice = missingDistricts.slice(start, start + batchSize);
      await prisma.district.createMany({
        data: slice.map((district) => ({ stateId: district.stateId, name: district.name })),
        skipDuplicates: true,
      });
    }
    const created = await prisma.district.findMany({
      where: { stateId: { in: [...byState.keys()] } },
      select: { id: true, stateId: true, name: true },
    });
    for (const district of created) {
      districtIdByKey.set(districtKey(district.stateId, district.name), district.id);
    }
    result.districtsCreated = missingDistricts.length;
    log(`created ${missingDistricts.length} districts`);
  } else if (options.dryRun) {
    result.districtsCreated = missingDistricts.length;
  }

  const allPins = [...pending.values()].filter((entry) => {
    const stateId = stateIdByName.get(normalizeStateName(entry.stateName));
    return Boolean(stateId);
  });

  for (let start = 0; start < allPins.length; start += batchSize) {
    const slice = allPins.slice(start, start + batchSize);
    const existingRows = await prisma.pinCode.findMany({
      where: { pinCode: { in: slice.map((entry) => entry.pinCode) } },
      select: {
        pinCode: true,
        officeName: true,
        districtId: true,
        stateId: true,
        latitude: true,
        longitude: true,
      },
    });
    const existingByPin = new Map(existingRows.map((row) => [row.pinCode, row]));

    const inserts: Array<{
      pinCode: string;
      officeName: string;
      districtId: string | null;
      stateId: string;
      latitude: number | null;
      longitude: number | null;
    }> = [];
    const updates: Array<{ pinCode: string; data: Record<string, unknown> }> = [];

    for (const entry of slice) {
      const stateId = stateIdByName.get(normalizeStateName(entry.stateName)) as string;
      const districtId = entry.districtName
        ? (districtIdByKey.get(districtKey(stateId, entry.districtName)) ?? null)
        : null;
      const existing = existingByPin.get(entry.pinCode);

      if (!existing) {
        inserts.push({
          pinCode: entry.pinCode,
          officeName: entry.officeName,
          districtId,
          stateId,
          latitude: entry.latitude,
          longitude: entry.longitude,
        });
        continue;
      }

      const changed =
        existing.officeName !== entry.officeName ||
        existing.districtId !== districtId ||
        existing.stateId !== stateId ||
        existing.latitude !== entry.latitude ||
        existing.longitude !== entry.longitude;

      if (!changed) {
        result.unchanged += 1;
        continue;
      }

      updates.push({
        pinCode: entry.pinCode,
        data: {
          officeName: entry.officeName,
          districtId,
          stateId,
          latitude: entry.latitude,
          longitude: entry.longitude,
        },
      });
    }

    if (!options.dryRun) {
      if (inserts.length > 0) {
        await prisma.pinCode.createMany({ data: inserts, skipDuplicates: true });
      }
      if (updates.length > 0) {
        await prisma.$transaction(
          updates.map((update) =>
            prisma.pinCode.update({ where: { pinCode: update.pinCode }, data: update.data }),
          ),
        );
      }
    }

    result.added += inserts.length;
    result.updated += updates.length;
    if (start % (batchSize * 20) === 0) {
      log(`processed ${Math.min(start + slice.length, allPins.length)}/${allPins.length} PINs`);
    }
  }

  result.skipped = Object.values(skippedReasons).reduce((sum, count) => sum + count, 0);
  result.durationMs = Date.now() - started;
  return result;
}
