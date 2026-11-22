import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { documentRequirementsFor, providerTypes } from '@curenear/shared';
import { createPrismaClient } from '@curenear/db';

/**
 * SYNTHETIC TEST DATA ONLY — never run this against production.
 *
 * Generates providers, documents and licences for exercising the admin provider
 * directory at scale (the acceptance target is 100,000 providers under 300 ms).
 * Every row is marked so it can be removed again:
 *
 *   - legal_name / trade_name start with "[SYNTHETIC TEST DATA]"
 *   - registration_number starts with "TEST-SYN-"
 *   - staff accounts are `synthetic-directory-<n>@test.invalid`
 *
 * Usage (from the repository root):
 *
 *   pnpm --filter @curenear/db exec tsx ../../scripts/seed-provider-directory.ts --count=100000
 *   pnpm --filter @curenear/db exec tsx ../../scripts/seed-provider-directory.ts --clean
 *
 * The generator is deterministic in shape, not in values: PINs, statuses, dates
 * and document completeness are spread pseudo-randomly.
 */

const MARKER = 'TEST-SYN-';
const EMAIL_DOMAIN = 'test.invalid';
const BATCH = 5_000;

interface Options {
  count: number;
  staff: number;
  clean: boolean;
  skipDocuments: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: number): number => {
    const match = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (!match) return fallback;
    const value = Number(match.slice(name.length + 3));
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a number`);
    return Math.floor(value);
  };
  return {
    count: get('count', 100_000),
    staff: get('staff', 20),
    clean: argv.includes('--clean'),
    skipDocuments: argv.includes('--skip-documents'),
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
    throw new Error('Refusing to seed synthetic providers in production');
  }

  const options = parseArgs(process.argv.slice(2));
  const db = createPrismaClient();

  try {
    if (options.clean) {
      const organizations = await db.providerOrganization.deleteMany({
        where: { registrationNumber: { startsWith: MARKER } },
      });
      const users = await db.user.deleteMany({
        where: {
          email: { startsWith: 'synthetic-directory-', endsWith: `@${EMAIL_DOMAIN}` },
        },
      });
      process.stdout.write(
        `Removed ${organizations.count} synthetic provider(s) and ${users.count} synthetic account(s).\n`,
      );
      return;
    }

    // --- Synthetic staff ---------------------------------------------------
    const staffIds: string[] = [];
    for (let index = 0; index < Math.max(1, options.staff); index += 1) {
      const email = `synthetic-directory-${index + 1}@${EMAIL_DOMAIN}`;
      const user = await db.user.upsert({
        where: { email },
        update: { name: `[SYNTHETIC TEST DATA] staff ${index + 1}`, deletedAt: null },
        create: {
          email,
          name: `[SYNTHETIC TEST DATA] staff ${index + 1}`,
          passwordHash: 'synthetic-test-data-no-login',
          role: 'STAFF',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      staffIds.push(user.id);
    }

    // --- Geography ---------------------------------------------------------
    const pins = [
      '700001',
      '700006',
      '700016',
      '700019',
      '700020',
      '700026',
      '700029',
      '700032',
      '700040',
      '700054',
      '700064',
      '700091',
      '700094',
      '700099',
      '700102',
      '700106',
      '110001',
      '110005',
      '110016',
      '110024',
      '110048',
      '110075',
      '400001',
      '400004',
      '400012',
      '400051',
      '400053',
      '400070',
      '400076',
      '400080',
      '560001',
      '560003',
      '560025',
      '560034',
      '560043',
      '560076',
      '600001',
      '600004',
      '600010',
      '600020',
      '600028',
      '600042',
      '500001',
      '500034',
      '500081',
      '411001',
      '411004',
      '411014',
      '380001',
      '380015',
    ];
    const pinRows = await db.pinCode.findMany({
      where: { pinCode: { in: pins } },
      select: { pinCode: true, stateId: true, districtId: true },
    });
    const geography = pinRows.length
      ? pinRows.map((row) => ({
          pin: row.pinCode,
          stateId: row.stateId,
          districtId: row.districtId,
        }))
      : pins.map((pin) => ({ pin, stateId: null, districtId: null }));

    // --- Providers ---------------------------------------------------------
    // Same order as the ProviderType array in the query below.
    const typeLabels = [
      'Doctor Practice',
      'Clinic',
      'Pharmacy',
      'Diagnostic Centre',
      'Care Provider',
    ];
    const statuses = [
      'DRAFT',
      'DRAFT',
      'DRAFT',
      'DRAFT',
      'DRAFT',
      'DRAFT',
      'SUBMITTED',
      'SUBMITTED',
      'SUBMITTED',
      'SUBMITTED',
      'SUBMITTED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'UNDER_REVIEW',
      'UNDER_REVIEW',
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
      'APPROVED',
      'APPROVED',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
      'TERMINATED',
    ];

    let inserted = 0;
    while (inserted < options.count) {
      const take = Math.min(BATCH, options.count - inserted);
      const created = await db.$executeRaw`
        WITH types AS (
          SELECT ARRAY[${Prisma.join(
            providerTypes.map((type) => Prisma.sql`${type}`),
          )}]::text[] AS arr
        ),
        states AS (SELECT ARRAY[${Prisma.join(
          statuses.map((status) => Prisma.sql`${status}`),
        )}]::text[] AS arr),
        geo AS (SELECT ${JSON.stringify(geography)}::jsonb AS arr),
        picked AS (
          SELECT i,
                 1 + floor(random() * 5)::int AS type_index,
                 1 + floor(random() * cardinality(states.arr))::int AS status_index,
                 1 + floor(random() * jsonb_array_length(geo.arr))::int AS geo_index,
                 random() * 1000 AS age_days
          FROM generate_series(1, ${take}) AS series(i), states, geo
        )
        INSERT INTO provider_organizations (
          id, code, provider_type, status, legal_name, trade_name, constitution_type,
          registration_number, mobile, email, primary_pin_code, primary_state_id,
          primary_district_id, type_data, created_by_user_id, submitted_at, created_at, updated_at
        )
        SELECT gen_random_uuid(),
               next_provider_code(types.arr[picked.type_index]::"ProviderType"),
               types.arr[picked.type_index]::"ProviderType",
               states.arr[picked.status_index]::"ProviderOrganizationStatus",
               '[SYNTHETIC TEST DATA] ' || (ARRAY[${Prisma.join(
                 typeLabels.map((label) => Prisma.sql`${label}`),
               )}])[picked.type_index] || ' ' ||
                 lpad((${inserted} + picked.i)::text, 6, '0'),
               NULL,
               'private_limited',
               ${MARKER} || lpad((${inserted} + picked.i)::text, 9, '0'),
               '9' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0'),
               'synthetic-' || (${inserted} + picked.i)::text || '@${EMAIL_DOMAIN}',
               (geo.arr -> (picked.geo_index - 1)) ->> 'pin',
               nullif((geo.arr -> (picked.geo_index - 1)) ->> 'stateId', '')::uuid,
               nullif((geo.arr -> (picked.geo_index - 1)) ->> 'districtId', '')::uuid,
               '{}'::jsonb,
               ${staffIds[(inserted + 1) % staffIds.length]}::uuid,
               CASE WHEN states.arr[picked.status_index] = 'DRAFT'
                    THEN NULL
                    ELSE now() - (picked.age_days - 1) * interval '1 day' + interval '3 hours'
               END,
               now() - picked.age_days * interval '1 day',
               now() - picked.age_days * interval '1 day'
        FROM picked, types, states, geo
      `;
      inserted += created;
      process.stdout.write(`  inserted ${inserted}/${options.count} providers\r`);
    }
    process.stdout.write('\n');

    if (options.skipDocuments) {
      process.stdout.write('Skipped document and licence rows (--skip-documents).\n');
      return;
    }

    // --- Documents ---------------------------------------------------------
    // Half the rows get every always-required document role, half get only the
    // first, so `missingDocuments=true|false` both have plenty of matches.
    const documentRoles = providerTypes.map((providerType) => ({
      providerType,
      roles: documentRequirementsFor(providerType)
        .filter((requirement) => requirement.requirement === 'required')
        .filter((requirement) => !requirement.key.includes('.'))
        .map((requirement) => requirement.key),
    }));
    const values = documentRoles
      .map(
        ({ providerType, roles }) =>
          `('${providerType}', ARRAY[${roles.map((role) => `'${role}'`).join(',')}]::text[])`,
      )
      .join(', ');

    const documents = await db.$executeRawUnsafe(`
      INSERT INTO provider_documents (
        id, organization_id, file_name, mime_type, size_bytes, storage_key, role,
        uploaded_by_user_id, created_at
      )
      SELECT gen_random_uuid(), o.id, 'synthetic-document.pdf', 'application/pdf', 1024,
             NULL, role, o.created_by_user_id, o.created_at
      FROM provider_organizations o
      JOIN (VALUES ${values}) AS req(provider_type, roles)
        ON req.provider_type = o.provider_type::text
      CROSS JOIN LATERAL unnest(req.roles) AS role
      WHERE o.registration_number LIKE '${MARKER}%'
        AND (
          (('x' || substr(md5(o.id::text), 1, 8))::bit(32)::bigint & 1) = 0
          OR role = req.roles[1]
        )
    `);
    process.stdout.write(`Inserted ${documents} synthetic document rows.\n`);

    // --- Licences ----------------------------------------------------------
    const licences = await db.$executeRaw`
      INSERT INTO provider_licences (
        id, organization_id, number, authority, issued_on, valid_from, valid_to,
        status, details, created_at, updated_at
      )
      SELECT gen_random_uuid(),
             o.id,
             'SYN-LIC-' || lpad((floor(random() * 10000000))::bigint::text, 7, '0'),
             'Synthetic Licensing Authority',
             CURRENT_DATE - 400,
             CURRENT_DATE - 400,
             CURRENT_DATE + (floor(random() * 900) - 60)::int,
             'active',
             '{"role": "synthetic"}'::jsonb,
             o.created_at,
             now()
      FROM provider_organizations o
      WHERE o.registration_number LIKE ${`${MARKER}%`}
        AND random() < 0.6
    `;
    process.stdout.write(`Inserted ${licences} synthetic licence rows.\n`);

    process.stdout.write(
      [
        '',
        'SYNTHETIC TEST DATA seeded.',
        `  providers: ${options.count}`,
        `  accounts:  ${staffIds.length}`,
        '',
        'Remove it again with --clean. Do not use these rows for anything but',
        'directory and index testing.',
        '',
      ].join('\n'),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
