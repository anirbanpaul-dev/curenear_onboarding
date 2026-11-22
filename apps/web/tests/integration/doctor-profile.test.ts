import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import type { Actor } from '@curenear/shared';
import { createProviderOnboardingService } from '@/server/services/provider-onboarding-service';

/** A self-onboarded doctor saves the same registry sections the clinic form uses. */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

describeDb('doctor profile sections (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createProviderOnboardingService>;
  let actor: Actor;
  let userId = '';
  let organizationId = '';

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    service = createProviderOnboardingService({
      ...createPersistence(prisma),
      now: () => new Date(),
      newId: () => randomUUID(),
    });
    const user = await prisma.user.upsert({
      where: { email: 'doctor-profile@test.local' },
      update: { role: 'STAFF', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'doctor-profile@test.local',
        name: 'Doctor Profile',
        passwordHash: 'not-used',
        role: 'STAFF',
      },
    });
    userId = user.id;
    actor = { userId, role: 'STAFF' };
  });

  afterAll(async () => {
    if (!prisma) return;
    const organizations = await prisma.providerOrganization.findMany({
      where: { createdByUserId: userId },
      select: { id: true },
    });
    const ids = organizations.map((row) => row.id);
    await prisma.doctorProfile.deleteMany({
      where: { OR: [{ createdByOrgId: { in: ids } }, { organizationId: { in: ids } }] },
    });
    await prisma.providerOrganization.deleteMany({ where: { createdByUserId: userId } });
    await prisma.$disconnect();
  });

  it('saves identity, qualifications and a practice through the registry', async () => {
    const created = await service.create(
      actor,
      {
        provider_type: 'doctor',
        legal_name: 'Dr Profile Test',
        mobile: '9830012345',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    organizationId = created.provider.id;
    await service.createDocument(actor, organizationId, {
      file_name: 'registration.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      role: 'medical_registration',
    });

    await service.saveDoctorProfile(
      actor,
      organizationId,
      {
        version: created.provider.version,
        section: 'doctor_identity',
        data: {
          doc_full_name: 'Dr Profile Test',
          doc_reg_no: `WBMC/PROFILE/${Date.now()}`,
          doc_reg_council: 'NMC',
          doc_system: 'allopathy',
          doc_reg_date: '2020-01-01',
          doc_reg_valid_to: '2030-01-01',
        },
      },
      ctx(),
    );

    let detail = await service.get(actor, organizationId);
    await service.saveDoctorProfile(
      actor,
      organizationId,
      {
        version: detail.organization.version,
        section: 'doctor_qualifications',
        data: {
          doc_qualifications: [{ degree: 'MBBS', institution: 'Medical College', year: 2015 }],
          doc_specialty: 'general medicine',
          doc_subspecialty: ['cardiology'],
          doc_experience_years: 10,
          doc_languages: ['English'],
        },
      },
      ctx(),
    );

    detail = await service.get(actor, organizationId);
    expect(detail.doctorProfile?.registrationNo).toContain('WBMC/PROFILE/');
    expect(detail.doctorProfile?.councilName).toBe('NMC');
    expect(detail.doctorProfile?.specialtyName).toBe('general medicine');
    expect(detail.doctorProfile?.qualifications).toHaveLength(1);
    expect(detail.organization.typeData.doc_experience_years).toBe(10);

    await service.createDoctorPractice(
      actor,
      organizationId,
      {
        practice_type: 'own clinic',
        address: {
          line1: '1 Test Street',
          city: 'Kolkata',
          state: 'West Bengal',
          pin: '700091',
        },
        timings: [{ day: 'Monday', start: '09:00', end: '13:00', slot_minutes: 15 }],
        fee_paise: 80000,
        public_contact: '9830012345',
      },
      ctx(),
    );

    detail = await service.get(actor, organizationId);
    expect(detail.doctorPractices).toHaveLength(1);
    const sections = new Map(
      detail.completeness.sections.map((section) => [section.key, section.status]),
    );
    expect(sections.get('doctor_identity')).toBe('complete');
    expect(sections.get('doctor_qualifications')).toBe('complete');
    expect(sections.get('doctor_practice')).toBe('complete');
  });
});
