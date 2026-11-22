import { createPersistenceFromEnv } from '@curenear/db';
import { doctorVerificationItems, requiredVerificationItemsFor } from '@curenear/shared';

/**
 * `pnpm db:backfill-review`
 *
 * Generates the review checklist for providers that were submitted before the
 * review workflow existed (or imported outside the submit path). Idempotent:
 * existing rows are left untouched. Clinics also get rows for linked doctors.
 */
async function main(): Promise<void> {
  const { db, repositories } = createPersistenceFromEnv();
  try {
    const organizations = await db.providerOrganization.findMany({
      where: { deletedAt: null },
      select: { id: true, providerType: true },
      orderBy: { createdAt: 'asc' },
    });

    let organizationsSeeded = 0;
    let organizationItems = 0;
    let doctorItems = 0;

    for (const organization of organizations) {
      const items = requiredVerificationItemsFor(organization.providerType);
      const created = await repositories.reviews.seed(organization.id, items);
      organizationItems += created;
      if (created > 0) organizationsSeeded += 1;

      if (organization.providerType === 'clinic') {
        const links = await repositories.onboarding.listClinicDoctorLinks(organization.id);
        for (const link of links) {
          doctorItems += await repositories.reviews.seedDoctor(
            link.doctor.id,
            doctorVerificationItems(),
          );
        }
      }
    }

    console.warn(
      `Review checklist backfill: ${organizationsSeeded}/${organizations.length} providers, ` +
        `${organizationItems} provider items, ${doctorItems} doctor items created.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Review checklist backfill failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
