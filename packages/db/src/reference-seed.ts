import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  councilSeeds,
  documentTypeSeeds,
  facilityTypeSeeds,
  licenceTypeSeeds,
  serviceCategorySeeds,
  specialtySeeds,
  stateSeeds,
} from './reference-data';

export interface ReferenceSeedCounts {
  states: number;
  councils: number;
  specialties: number;
  serviceCategories: number;
  facilityTypes: number;
  licenceTypes: number;
  documentTypes: number;
}

/**
 * Seeds the master-data baseline. Upserts by `code`, so running it repeatedly
 * converges on the values below: it never duplicates rows, but it does restore
 * the seeded values on rows an administrator has edited. Run it to bootstrap a
 * database, not to keep it in sync afterwards.
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<ReferenceSeedCounts> {
  const stateIdByName = new Map<string, string>();

  for (const state of stateSeeds) {
    const row = await prisma.state.upsert({
      where: { code: state.code },
      update: { name: state.name },
      create: { id: randomUUID(), code: state.code, name: state.name },
      select: { id: true, name: true },
    });
    stateIdByName.set(state.name, row.id);
  }

  for (const council of councilSeeds) {
    const stateId = council.stateName ? (stateIdByName.get(council.stateName) ?? null) : null;
    await prisma.council.upsert({
      where: { code: council.code },
      update: { name: council.name, kind: council.kind, stateId },
      create: {
        id: randomUUID(),
        code: council.code,
        name: council.name,
        kind: council.kind,
        stateId,
      },
    });
  }

  for (const specialty of specialtySeeds) {
    await prisma.specialty.upsert({
      where: { code: specialty.code },
      update: {
        name: specialty.name,
        systemOfMedicine: specialty.systemOfMedicine,
      },
      create: { id: randomUUID(), ...specialty },
    });
  }

  for (const category of serviceCategorySeeds) {
    await prisma.serviceCategory.upsert({
      where: { code: category.code },
      update: { name: category.name, providerType: category.providerType },
      create: { id: randomUUID(), ...category },
    });
  }

  for (const facility of facilityTypeSeeds) {
    await prisma.facilityType.upsert({
      where: { code: facility.code },
      update: { name: facility.name },
      create: { id: randomUUID(), ...facility },
    });
  }

  for (const licence of licenceTypeSeeds) {
    await prisma.licenceType.upsert({
      where: { code: licence.code },
      update: {
        name: licence.name,
        applicableProviderTypes: licence.applicableProviderTypes,
      },
      create: { id: randomUUID(), ...licence },
    });
  }

  for (const document of documentTypeSeeds) {
    await prisma.documentType.upsert({
      where: { code: document.code },
      update: {
        name: document.name,
        providerTypes: document.providerTypes,
        requiresExpiry: document.requiresExpiry,
        expiryReminderDays: document.expiryReminderDays,
      },
      create: { id: randomUUID(), ...document },
    });
  }

  return {
    states: stateSeeds.length,
    councils: councilSeeds.length,
    specialties: specialtySeeds.length,
    serviceCategories: serviceCategorySeeds.length,
    facilityTypes: facilityTypeSeeds.length,
    licenceTypes: licenceTypeSeeds.length,
    documentTypes: documentTypeSeeds.length,
  };
}
