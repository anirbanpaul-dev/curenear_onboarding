import { Prisma } from '@prisma/client';
import type {
  PinStatMeasure,
  PrismaClient,
  ProviderOrganizationStatus,
  ProviderType,
} from '@prisma/client';
import type { DbClient } from '../client';

/**
 * `provider_pin_stats` read model.
 *
 * Definitions (docs/decisions.md, "Provider analytics per PIN"):
 * - `primary`: one per live organisation, at its **primary location** PIN.
 * - `doctor_practice`: one per active doctor practice location, at that PIN; a
 *   doctor linked to a clinic counts at the clinic's primary PIN.
 * - `service`: one per service-area PIN (`provider_service_pins`).
 *
 * `provider_pin_contributions` remembers what each organisation currently
 * contributes, so the incremental path can subtract exactly what it added
 * before — a PIN change or a delete is just a diff. Rebuild and the nightly
 * check both recompute from the live tables with the same SQL.
 */

export interface PinStatsContribution {
  measure: PinStatMeasure;
  subjectId: string;
  pinCode: string;
  providerType: ProviderType;
  status: ProviderOrganizationStatus;
}

export interface PinStatsRow {
  pinCode: string;
  providerType: ProviderType;
  status: ProviderOrganizationStatus;
  measure: PinStatMeasure;
  count: number;
}

export interface PinStatsDrift {
  pinCode: string;
  providerType: ProviderType;
  status: ProviderOrganizationStatus;
  measure: PinStatMeasure;
  expected: number;
  actual: number;
}

const MEASURES: PinStatMeasure[] = ['primary', 'doctor_practice', 'service'];

/** What the organisation contributes right now, straight from the live tables. */
function contributionsFor(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'primary'::text AS measure,
             o.id AS subject_id,
             o.id AS organization_id,
             o.primary_pin_code AS pin_code,
             o.provider_type,
             o.status
      FROM provider_organizations o
      WHERE o.id = ${organizationId}::uuid
        AND o.deleted_at IS NULL
        AND o.primary_pin_code IS NOT NULL

      UNION ALL

      SELECT 'service',
             o.id,
             o.id,
             s.pin_code,
             o.provider_type,
             o.status
      FROM provider_service_pins s
      JOIN provider_organizations o ON o.id = s.organization_id
      WHERE o.id = ${organizationId}::uuid
        AND o.deleted_at IS NULL

      UNION ALL

      -- A doctor organisation's own practice locations.
      SELECT 'doctor_practice',
             d.id,
             d.organization_id,
             l.pin_code,
             'doctor'::"ProviderType",
             o.status
      FROM doctor_profiles d
      JOIN provider_organizations o ON o.id = d.organization_id
      JOIN doctor_locations dl
        ON dl.doctor_profile_id = d.id
       AND dl.status = 'active'
       AND dl.location_id IS NOT NULL
      JOIN provider_locations l ON l.id = dl.location_id
      WHERE o.id = ${organizationId}::uuid
        AND o.deleted_at IS NULL
        AND d.deleted_at IS NULL
        AND d.organization_id IS NOT NULL

      UNION ALL

      -- A doctor linked to a clinic practices at the clinic's primary PIN.
      SELECT 'doctor_practice',
             d.id,
             o.id,
             o.primary_pin_code,
             'doctor'::"ProviderType",
             o.status
      FROM doctor_locations dl
      JOIN doctor_profiles d ON d.id = dl.doctor_profile_id
      JOIN provider_organizations o ON o.id = dl.clinic_organization_id
      WHERE o.id = ${organizationId}::uuid
        AND o.deleted_at IS NULL
        AND d.deleted_at IS NULL
        AND o.primary_pin_code IS NOT NULL
    ) rows
    WHERE pin_code ~ '^[1-9][0-9]{5}$'
  `;
}

/** Every contribution in the database, for the full rebuild. */
const ALL_CONTRIBUTIONS = Prisma.sql`
  SELECT * FROM (
    SELECT 'primary'::text AS measure,
           o.id AS subject_id,
           o.id AS organization_id,
           o.primary_pin_code AS pin_code,
           o.provider_type,
           o.status
    FROM provider_organizations o
    WHERE o.deleted_at IS NULL
      AND o.primary_pin_code IS NOT NULL

    UNION ALL

    SELECT 'service',
           o.id,
           o.id,
           s.pin_code,
           o.provider_type,
           o.status
    FROM provider_service_pins s
    JOIN provider_organizations o ON o.id = s.organization_id
    WHERE o.deleted_at IS NULL

    UNION ALL

    SELECT 'doctor_practice',
           d.id,
           d.organization_id,
           l.pin_code,
           'doctor'::"ProviderType",
           o.status
    FROM doctor_profiles d
    JOIN provider_organizations o ON o.id = d.organization_id
    JOIN doctor_locations dl
      ON dl.doctor_profile_id = d.id
     AND dl.status = 'active'
     AND dl.location_id IS NOT NULL
    JOIN provider_locations l ON l.id = dl.location_id
    WHERE o.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND d.organization_id IS NOT NULL

    UNION ALL

    SELECT 'doctor_practice',
           d.id,
           o.id,
           o.primary_pin_code,
           'doctor'::"ProviderType",
           o.status
    FROM doctor_locations dl
    JOIN doctor_profiles d ON d.id = dl.doctor_profile_id
    JOIN provider_organizations o ON o.id = dl.clinic_organization_id
    WHERE o.deleted_at IS NULL
      AND d.deleted_at IS NULL
      AND o.primary_pin_code IS NOT NULL
  ) rows
  WHERE pin_code ~ '^[1-9][0-9]{5}$'
`;

function asContribution(row: {
  measure: string;
  subject_id: string;
  pin_code: string;
  provider_type: string;
  status: string;
}): PinStatsContribution {
  return {
    measure: row.measure as PinStatMeasure,
    subjectId: row.subject_id,
    pinCode: row.pin_code,
    providerType: row.provider_type as ProviderType,
    status: row.status as ProviderOrganizationStatus,
  };
}

async function liveContributions(
  db: DbClient,
  organizationId: string,
): Promise<PinStatsContribution[]> {
  const rows = await db.$queryRaw<
    Array<{
      measure: string;
      subject_id: string;
      pin_code: string;
      provider_type: string;
      status: string;
    }>
  >(
    Prisma.sql`SELECT DISTINCT ON (measure, subject_id, pin_code) * FROM (${contributionsFor(
      organizationId,
    )}) rows ORDER BY measure, subject_id, pin_code`,
  );
  return rows.map(asContribution);
}

/**
 * A contribution is identified by what it counts, where, and the status it was
 * counted under. A status change is therefore a removal plus an addition, not
 * an update of the same stat row.
 */
function contributionKey(
  row: Pick<PinStatsContribution, 'measure' | 'subjectId' | 'pinCode' | 'providerType' | 'status'>,
): string {
  return `${row.measure}|${row.subjectId}|${row.pinCode}|${row.providerType}|${row.status}`;
}

function adjustSql(
  tx: Prisma.TransactionClient,
  row: Pick<PinStatsContribution, 'pinCode' | 'providerType' | 'status' | 'measure'>,
  delta: number,
): Promise<number> {
  if (delta < 0) {
    // Subtraction must never invent a row (the read model may already be
    // missing one after an out-of-band write); drift repair is the rebuild.
    return tx.$executeRaw(Prisma.sql`
      UPDATE provider_pin_stats
      SET count = GREATEST(0, count + ${delta}), updated_at = CURRENT_TIMESTAMP
      WHERE pin_code = ${row.pinCode}
        AND provider_type = ${row.providerType}::"ProviderType"
        AND status = ${row.status}::"ProviderOrganizationStatus"
        AND measure = ${row.measure}::"PinStatMeasure"
    `);
  }

  return tx.$executeRaw(Prisma.sql`
    INSERT INTO provider_pin_stats (pin_code, provider_type, status, measure, count, updated_at)
    VALUES (${row.pinCode}, ${row.providerType}::"ProviderType", ${row.status}::"ProviderOrganizationStatus",
            ${row.measure}::"PinStatMeasure", ${delta}, CURRENT_TIMESTAMP)
    ON CONFLICT (pin_code, provider_type, status, measure)
    DO UPDATE SET count = provider_pin_stats.count + ${delta},
                  updated_at = CURRENT_TIMESTAMP
  `);
}

/**
 * Incremental update after an event. Idempotent: re-running for the same
 * organisation computes the same contributions and applies a zero delta.
 */
export async function recomputeProviderPinStats(
  db: PrismaClient,
  organizationId: string,
): Promise<{ added: number; removed: number }> {
  const desired = await liveContributions(db, organizationId);
  const stored = await db.providerPinContribution.findMany({ where: { organizationId } });

  const desiredKeys = new Set(desired.map(contributionKey));
  const storedKeys = new Set(stored.map(contributionKey));

  const additions = desired.filter((row) => !storedKeys.has(contributionKey(row)));
  const removals = stored.filter((row) => !desiredKeys.has(contributionKey(row)));

  await db.$transaction(async (tx) => {
    for (const row of removals) await adjustSql(tx, row, -1);
    for (const row of additions) await adjustSql(tx, row, 1);

    // Zero rows carry no information; removing them keeps the table small.
    const touched = [...removals, ...additions];
    if (touched.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM provider_pin_stats s
        USING (VALUES ${Prisma.join(
          touched.map(
            (row) =>
              Prisma.sql`(${row.pinCode}::char(6), ${row.providerType}::"ProviderType", ${row.status}::"ProviderOrganizationStatus", ${row.measure}::"PinStatMeasure")`,
          ),
        )}) AS t(pin_code, provider_type, status, measure)
        WHERE s.pin_code = t.pin_code
          AND s.provider_type = t.provider_type
          AND s.status = t.status
          AND s.measure = t.measure
          AND s.count <= 0
      `);
    }

    // The contribution ledger is replaced with what the organisation looks like
    // now, so the next event diffs against reality.
    await tx.providerPinContribution.deleteMany({ where: { organizationId } });
    if (desired.length > 0) {
      await tx.providerPinContribution.createMany({
        data: desired.map((row) => ({
          measure: row.measure,
          subjectId: row.subjectId,
          organizationId,
          pinCode: row.pinCode,
          providerType: row.providerType,
          status: row.status,
        })),
      });
    }
  });

  return { added: additions.length, removed: removals.length };
}

/**
 * `pnpm db:rebuild-stats`: truncate and recompute both tables from the live
 * data. Safe to run while the worker is up; it takes a single transaction.
 */
export async function rebuildProviderPinStats(
  db: PrismaClient,
): Promise<{ statsRows: number; contributions: number }> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`TRUNCATE TABLE provider_pin_stats`;
    await tx.$executeRaw`TRUNCATE TABLE provider_pin_contributions`;

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO provider_pin_contributions
        (measure, subject_id, organization_id, pin_code, provider_type, status)
      SELECT DISTINCT ON (measure, subject_id, pin_code)
             measure::"PinStatMeasure", subject_id, organization_id, pin_code, provider_type, status
      FROM (${ALL_CONTRIBUTIONS}) c
      ORDER BY measure, subject_id, pin_code
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO provider_pin_stats (pin_code, provider_type, status, measure, count, updated_at)
      SELECT pin_code, provider_type, status, measure::"PinStatMeasure", COUNT(*)::int,
             CURRENT_TIMESTAMP
      FROM (${ALL_CONTRIBUTIONS}) c
      GROUP BY pin_code, provider_type, status, measure
    `);
  });

  const [statsRows, contributions] = await Promise.all([
    db.providerPinStats.count(),
    db.providerPinContribution.count(),
  ]);
  return { statsRows, contributions };
}

/**
 * Nightly consistency check: compare the read model with counts computed from
 * the live tables. Returns the first `limit` differing rows.
 */
export async function checkProviderPinStats(
  db: PrismaClient,
  limit = 50,
): Promise<{ drift: PinStatsDrift[]; driftCount: number }> {
  const rows = await db.$queryRaw<Array<{ kind: string; total: number }>>(Prisma.sql`
    WITH live AS (
      SELECT pin_code, provider_type, status, measure, COUNT(*)::int AS count
      FROM (${ALL_CONTRIBUTIONS}) c
      GROUP BY pin_code, provider_type, status, measure
    )
    SELECT 'drift' AS kind, COUNT(*)::int AS total
    FROM (
      SELECT l.pin_code, l.provider_type, l.status, l.measure
      FROM live l
      LEFT JOIN provider_pin_stats s
        ON s.pin_code = l.pin_code AND s.provider_type = l.provider_type
       AND s.status = l.status AND s.measure::text = l.measure
      WHERE s.count IS NULL OR s.count <> l.count
      UNION ALL
      SELECT s.pin_code, s.provider_type, s.status, s.measure::text
      FROM provider_pin_stats s
      LEFT JOIN live l
        ON s.pin_code = l.pin_code AND s.provider_type = l.provider_type
       AND s.status = l.status AND s.measure::text = l.measure
      WHERE l.pin_code IS NULL
    ) d
  `);

  const detail = await db.$queryRaw<
    Array<{
      pin_code: string;
      provider_type: string;
      status: string;
      measure: string;
      expected: number;
      actual: number;
    }>
  >(Prisma.sql`
    WITH live AS (
      SELECT pin_code, provider_type, status, measure, COUNT(*)::int AS count
      FROM (${ALL_CONTRIBUTIONS}) c
      GROUP BY pin_code, provider_type, status, measure
    )
    SELECT COALESCE(l.pin_code, s.pin_code) AS pin_code,
           COALESCE(l.provider_type, s.provider_type)::text AS provider_type,
           COALESCE(l.status, s.status)::text AS status,
           COALESCE(l.measure, s.measure::text) AS measure,
           COALESCE(l.count, 0) AS expected,
           COALESCE(s.count, 0) AS actual
    FROM live l
    FULL OUTER JOIN provider_pin_stats s
      ON s.pin_code = l.pin_code AND s.provider_type = l.provider_type
     AND s.status = l.status AND s.measure::text = l.measure
    WHERE COALESCE(l.count, 0) <> COALESCE(s.count, 0)
    ORDER BY COALESCE(l.pin_code, s.pin_code)
    LIMIT ${limit}
  `);

  return {
    driftCount: Number(rows[0]?.total ?? 0),
    drift: detail.map((row) => ({
      pinCode: row.pin_code,
      providerType: row.provider_type as ProviderType,
      status: row.status as ProviderOrganizationStatus,
      measure: row.measure as PinStatMeasure,
      expected: Number(row.expected),
      actual: Number(row.actual),
    })),
  };
}

export { MEASURES as pinStatMeasures };
