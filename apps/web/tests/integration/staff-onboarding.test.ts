import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import {
  declarationsFor,
  formSectionsFor,
  locationTypes,
  type Actor,
  type ProviderField,
  type ProviderSection,
} from '@curenear/shared';
import { createProviderOnboardingService } from '@/server/services/provider-onboarding-service';
import { createConsentService } from '@/server/services/consent-service';

/**
 * Walks a clinic draft through every registry requirement, submits it and checks
 * that the staff list shows SUBMITTED. The data is generated from the registry so
 * this test keeps working when required fields are added.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

function scalar(field: ProviderField): unknown {
  const options = field.validation?.options ?? [];
  switch (field.type) {
    case 'email':
      return 'provider@example.com';
    case 'phone':
      return '9830012345';
    case 'url':
      return 'https://example.com';
    case 'select':
      return options[0] ?? 'other';
    case 'multiselect':
      return [options[0] ?? 'other'];
    case 'boolean':
      return true;
    case 'number':
      return 1;
    case 'money':
      return 1000;
    case 'date':
      return '2027-01-01';
    case 'time':
      return '09:00';
    case 'pin':
      return '700091';
    case 'pinlist':
      return ['700091'];
    case 'address':
      return { line1: '1 Test Street', city: 'Kolkata', state: 'West Bengal', pin: '700091' };
    case 'geo':
      return { lat: 22.5726, lng: 88.3639 };
    case 'repeater': {
      const row: Record<string, unknown> = {};
      for (const item of field.items ?? []) {
        const synthetic: ProviderField = {
          key: item.key,
          label: item.label,
          type: item.type,
          requirement: 'required',
          section: field.section,
          clause: field.clause,
          storage: { kind: 'type_data' },
          validation: item.validation,
          items: item.items,
        };
        row[item.key] = scalar(synthetic);
      }
      return [row];
    }
    default:
      return 'Test value';
  }
}

function sectionPayload(section: ProviderSection): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of section.fields) {
    if (field.adminOnly || field.storage.kind === 'related') continue;
    if (field.requirement === 'optional') continue;
    payload[field.key] = scalar(field);
  }
  return payload;
}

describeDb('staff onboarding submit path (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createProviderOnboardingService>;
  let consents: ReturnType<typeof createConsentService>;
  let actor: Actor;
  const userIds: string[] = [];
  let organizationId = '';

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    const persistence = createPersistence(prisma);
    service = createProviderOnboardingService({
      ...persistence,
      now: () => new Date(),
      newId: () => randomUUID(),
    });
    consents = createConsentService({
      ...persistence,
      now: () => new Date(),
      newId: () => randomUUID(),
      appUrl: 'http://localhost:3000',
      environment: 'test',
      confirmationLinksEnabled: true,
    });

    const user = await prisma.user.upsert({
      where: { email: 'wizard-submit@test.local' },
      update: { role: 'STAFF', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'wizard-submit@test.local',
        name: 'Wizard Submit',
        passwordHash: 'not-used',
        role: 'STAFF',
      },
    });
    userIds.push(user.id);
    actor = { userId: user.id, role: 'STAFF' };
  });

  afterAll(async () => {
    if (!prisma) return;
    const organizations = await prisma.providerOrganization.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    });
    const ids = organizations.map((row) => row.id);
    await prisma.doctorProfile.deleteMany({
      where: { OR: [{ createdByOrgId: { in: ids } }, { organizationId: { in: ids } }] },
    });
    await prisma.providerOrganization.deleteMany({
      where: { createdByUserId: { in: userIds } },
    });
    await prisma.$disconnect();
  });

  it('completes every registry requirement and submits to the my-providers list', async () => {
    const created = await service.create(
      actor,
      {
        provider_type: 'clinic',
        legal_name: 'Wizard Submit Clinic',
        mobile: '9830012345',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    organizationId = created.provider.id;
    const sections = formSectionsFor('clinic').filter((section) => !section.notInProviderForm);

    // Related rows are what completeness looks at for locations, contacts,
    // insurance, service PINs, licences and documents.
    await service.createLocation(actor, organizationId, {
      name: 'Registered office',
      location_type: locationTypes[0],
      address_line1: '1 Test Street',
      city: 'Kolkata',
      pin_code: '700091',
      is_primary: true,
    });

    const contactRoles = new Set<string>(['signatory', 'legal_notice']);
    const documentRoles = new Set<string>();
    const licenceRoles = new Set<string>();
    for (const section of sections) {
      for (const field of section.fields) {
        if (field.storage.kind !== 'related') continue;
        if (field.storage.table === 'provider_contacts' && field.storage.role) {
          contactRoles.add(field.storage.role);
        }
        if (field.storage.table === 'provider_documents') {
          documentRoles.add(field.storage.role ?? field.key);
        }
        if (field.storage.table === 'provider_licences' && field.storage.role) {
          licenceRoles.add(field.storage.role);
        }
      }
    }

    for (const role of contactRoles) {
      await service.saveContact(actor, organizationId, {
        role,
        name: role === 'legal_notice' ? 'Legal notice' : 'Test Contact',
        phone: '9830012345',
        ...(role === 'legal_notice'
          ? {
              email: 'legal@example.com',
              address: {
                line1: '1 Test Street',
                city: 'Kolkata',
                state: 'West Bengal',
                pin: '700091',
              },
            }
          : {}),
      });
    }

    await service.addServicePin(actor, organizationId, {
      pin_code: '700091',
      service_kind: 'service',
    });
    await service.createInsurance(actor, organizationId, {
      type: 'professional indemnity',
      insurer: 'Test Insurer',
      policy_no: 'POL-1',
      limit_paise: 100000,
      valid_from: '2026-01-01',
      valid_to: '2027-01-01',
    });

    for (const role of licenceRoles) {
      await service.createLicence(actor, organizationId, {
        role,
        number: `LIC-${role}`,
        // "Other licences" is a registry repeater whose name is required.
        ...(role === 'other' ? { details: { name: 'Other licence' } } : {}),
      });
    }
    await service.createLicence(actor, organizationId, { number: 'LIC-GENERAL' });

    for (const role of documentRoles) {
      await service.createDocument(actor, organizationId, {
        file_name: `${role}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1024,
        role,
      });
    }

    // Save every column/type_data section. Two passes: conditions can depend on
    // values written in another section.
    for (let pass = 0; pass < 2; pass += 1) {
      let detail = await service.get(actor, organizationId);
      for (const section of sections) {
        const payload = sectionPayload(section);
        if (Object.keys(payload).length === 0) continue;
        const result = await service.saveSection(
          actor,
          organizationId,
          section.key,
          { version: detail.organization.version, data: payload },
          ctx(),
        );
        detail = { ...detail, organization: result.provider };
      }
    }

    let complete = await service.get(actor, organizationId);
    expect(complete.completeness.missingRequiredFields).toEqual([]);
    expect(complete.completeness.complete).toBe(true);

    // A clinic must name at least one doctor and its in-charge before submit.
    const added = await service.addClinicDoctor(
      actor,
      organizationId,
      {
        full_name: 'Dr Clinic Incharge',
        mobile: '9830012345',
        registration_no: 'WBMC/SUBMIT/1',
        council: 'NMC',
        system_of_medicine: 'allopathy',
        role_at_clinic: 'in-charge',
        timings: [{ day: 'Monday', start: '09:00', end: '13:00', slot_minutes: 15 }],
        fee_paise: 80000,
        clinic_attestation: true,
      },
      ctx(),
    );
    await service.saveSection(
      actor,
      organizationId,
      'clinic_establishment',
      { version: complete.organization.version, data: { clinic_incharge: added.doctor.id } },
      ctx(),
    );
    complete = await service.get(actor, organizationId);

    // Submission is blocked until the declarations, publication permission and
    // privacy acknowledgement are on record.
    await expect(
      service.submit(actor, organizationId, { version: complete.organization.version }, ctx()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { consents: expect.any(Array) },
    });

    await consents.get(actor, organizationId);
    await consents.capture(
      actor,
      organizationId,
      {
        method: 'IN_PERSON_ATTESTATION',
        attestation_name: 'Wizard Submit staff',
        items: [
          { consent_type: 'publication' },
          { consent_type: 'data_privacy_notice' },
          ...declarationsFor('clinic').map((declaration) => ({
            consent_type: 'declarations' as const,
            declaration_key: declaration.key,
          })),
        ],
      },
      ctx(),
    );

    const saved = await service.submit(
      actor,
      organizationId,
      { version: complete.organization.version },
      ctx(),
    );
    expect(saved.organization.status).toBe('SUBMITTED');

    const list = await service.list(actor);
    expect(list.find((row) => row.id === organizationId)?.status).toBe('SUBMITTED');
  });
});
