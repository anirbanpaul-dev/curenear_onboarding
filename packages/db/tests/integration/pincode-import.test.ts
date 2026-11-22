import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/client';
import { importPincodes } from '../../src/pincode-import';

/**
 * Import behaviour against a real database: the point of the test is that the
 * same CSV can be run twice without duplicating or rewriting anything.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const mapping = {
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

const csv = [
  'officename,pincode,Deliverystatus,Districtname,statename,latitude,longitude',
  '"Test Branch B.O",999901,Non-Delivery,Import District,Import State,,',
  '"Test Main S.O",999901,Delivery,Import District,Import State,22.5726,88.3639',
  '"Test Second S.O",999902,Delivery,Import District,Import State,22.6,88.4',
  '"Test Duplicate B.O",999902,Non-Delivery,Import District,Import State,,',
  'Broken Row,12,Delivery,Import District,Import State,,',
  '"Test Missing State S.O",999903,Delivery,Import District,Atlantis,,',
  '"Test Unknown District S.O",999904,Delivery,Nowhere,Import State,,',
].join('\r\n');

describeDb('pincode import (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let stateId: string;
  const stateCode = `ZZ-IMPORT-${randomUUID().slice(0, 8)}`;
  const stateName = `Import State ${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const state = await prisma.state.create({
      data: { id: randomUUID(), code: stateCode, name: stateName },
      select: { id: true },
    });
    stateId = state.id;
  });

  afterAll(async () => {
    // Only this run's rows: PINs imported by the test carry a test office name.
    await prisma.pinCode.deleteMany({
      where: { stateId, officeName: { startsWith: 'Test ' } },
    });
    await prisma.district.deleteMany({ where: { stateId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    await prisma.$disconnect();
  });

  it('imports once, then reports the same file as unchanged', async () => {
    const options = { mapping, csvText: csv.replace(/Import State/g, stateName) };

    const first = await importPincodes(prisma, options);

    expect(first.rowsRead).toBe(7);
    expect(first.uniquePins).toBe(4);
    expect(first.added).toBe(3); // 999901 (preferred row), 999902, 999904
    expect(first.updated).toBe(0);
    expect(first.unchanged).toBe(0);
    expect(first.districtsCreated).toBe(2);
    expect(first.skippedReasons['duplicate-pin-in-file']).toBe(1);
    expect(first.skippedReasons['invalid-pin']).toBe(1);
    expect(first.skippedReasons['unknown-state']).toBe(1);
    expect(first.unknownStates).toEqual(['Atlantis']);

    // The delivery office wins over the branch office for a shared PIN.
    const pin = await prisma.pinCode.findUnique({
      where: { pinCode: '999901' },
      include: { district: true, state: true },
    });
    expect(pin?.officeName).toBe('Test Main S.O');
    expect(pin?.district?.name).toBe('Import District');
    expect(pin?.stateId).toBe(stateId);
    expect(pin?.latitude).toBeCloseTo(22.5726);

    const second = await importPincodes(prisma, options);

    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);
    expect(second.districtsCreated).toBe(0);
    expect(await prisma.pinCode.count({ where: { stateId } })).toBe(3);
  });

  it('updates a changed row without touching the others', async () => {
    const changed = csv
      .replace(/Import State/g, stateName)
      .replace('"Test Second S.O"', '"Test Renamed S.O"');

    const result = await importPincodes(prisma, { mapping, csvText: changed });

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(2);

    const renamed = await prisma.pinCode.findUnique({ where: { pinCode: '999902' } });
    expect(renamed?.officeName).toBe('Test Renamed S.O');
  });

  it('writes nothing in a dry run', async () => {
    const before = await prisma.pinCode.count({ where: { stateId } });
    const result = await importPincodes(prisma, {
      mapping,
      csvText: csv.replace(/Import State/g, stateName).replace('999902', '999905'),
      dryRun: true,
    });

    // A dry run reports the insert (999905) and the changed 999902 office name
    // but leaves the table alone.
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(await prisma.pinCode.count({ where: { stateId } })).toBe(before);
  });
});
