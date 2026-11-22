import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersistence, createPrismaClient } from '@curenear/db';
import type { Actor } from '@curenear/shared';
import { createProviderOnboardingService } from '@/server/services/provider-onboarding-service';

/**
 * Section 6.5: a clinic adding a doctor must detect the same registration +
 * council and link the existing profile instead of creating a duplicate. The
 * link is per clinic, so removing it never removes the doctor profile.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const ctx = () => ({ requestId: randomUUID(), ipAddress: '127.0.0.1', userAgent: 'vitest' });

describeDb('clinic adds doctors (real PostgreSQL)', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ReturnType<typeof createProviderOnboardingService>;
  let actor: Actor;
  let userId = '';
  const clinicIds: string[] = [];
  const registrationNo = `WBMC/T${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl as string);
    service = createProviderOnboardingService({
      ...createPersistence(prisma),
      now: () => new Date(),
      newId: () => randomUUID(),
    });
    const user = await prisma.user.upsert({
      where: { email: 'clinic-doctors@test.local' },
      update: { role: 'STAFF', status: 'ACTIVE', mustChangePassword: false, deletedAt: null },
      create: {
        id: randomUUID(),
        email: 'clinic-doctors@test.local',
        name: 'Clinic Doctors',
        passwordHash: 'not-used',
        role: 'STAFF',
      },
    });
    userId = user.id;
    actor = { userId, role: 'STAFF' };
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.doctorProfile.deleteMany({ where: { createdByOrgId: { in: clinicIds } } });
    await prisma.providerOrganization.deleteMany({ where: { createdByUserId: userId } });
    await prisma.$disconnect();
  });

  async function createClinic(name: string) {
    const created = await service.create(
      actor,
      {
        provider_type: 'clinic',
        legal_name: name,
        mobile: '9830012345',
        primary_pin_code: '700091',
      },
      ctx(),
    );
    clinicIds.push(created.provider.id);
    return created.provider;
  }

  it('finds the existing doctor, links it to a second clinic and removes only the link', async () => {
    const firstClinic = await createClinic('Clinic A');
    const secondClinic = await createClinic('Clinic B');
    const timings = [{ day: 'Monday', start: '09:00', end: '13:00', slot_minutes: 15 }];

    const added = await service.addClinicDoctor(
      actor,
      firstClinic.id,
      {
        full_name: 'Dr Existing Profile',
        mobile: '9830012345',
        registration_no: registrationNo,
        council: 'NMC',
        system_of_medicine: 'allopathy',
        specialty: 'general medicine',
        qualifications: [{ degree: 'MBBS', institution: 'Medical College', year: 2015 }],
        role_at_clinic: 'full-time consultant',
        timings,
        fee_paise: 80000,
        clinic_attestation: true,
      },
      ctx(),
    );
    expect(added.doctor.status).toBe('invited');
    expect(added.doctor.createdByOrgId).toBe(firstClinic.id);
    expect(added.doctor.organizationId).toBeNull();

    await expect(
      service.addClinicDoctor(
        actor,
        secondClinic.id,
        {
          full_name: 'Dr Duplicate Attempt',
          mobile: '9830012345',
          registration_no: registrationNo,
          council: 'NMC',
          system_of_medicine: 'allopathy',
          role_at_clinic: 'visiting consultant',
          timings,
          fee_paise: 60000,
          clinic_attestation: true,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const matches = await service.searchClinicDoctors(actor, secondClinic.id, {
      registration_no: registrationNo,
      council: 'NMC',
    });
    expect(matches.map((row) => row.id)).toContain(added.doctor.id);

    const linked = await service.addClinicDoctor(
      actor,
      secondClinic.id,
      {
        doctor_profile_id: added.doctor.id,
        role_at_clinic: 'visiting consultant',
        timings,
        fee_paise: 60000,
        clinic_attestation: true,
      },
      ctx(),
    );
    expect(linked.doctor.id).toBe(added.doctor.id);
    expect(linked.link.clinicOrganizationId).toBe(secondClinic.id);
    expect(linked.link.roleAtClinic).toBe('visiting consultant');

    const profiles = await prisma.doctorProfile.findMany({
      where: { registrationNo, deletedAt: null },
    });
    expect(profiles).toHaveLength(1);

    const beforeRemoval = await service.listClinicDoctors(actor, firstClinic.id);
    expect(beforeRemoval).toHaveLength(1);

    await service.removeClinicDoctor(actor, secondClinic.id, linked.link.id);
    expect(await service.listClinicDoctors(actor, secondClinic.id)).toHaveLength(0);
    expect(await service.listClinicDoctors(actor, firstClinic.id)).toHaveLength(1);
    expect(await prisma.doctorProfile.count({ where: { registrationNo, deletedAt: null } })).toBe(
      1,
    );
  });

  it('refuses clinic submission without a doctor and an in-charge doctor', async () => {
    const clinic = await createClinic('Clinic No Doctors');
    await expect(
      service.submit(actor, clinic.id, { version: clinic.version }, ctx()),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
