import { Prisma } from '@prisma/client';
import type {
  AnalyticsFilters,
  AnalyticsGroupBy,
  AnalyticsGroupRow,
  AnalyticsOverview,
  AnalyticsPinSummary,
  OrganizationStatus,
  PinStatMeasure,
  ProviderType,
  StaffPerformanceResult,
} from '@curenear/shared';
import type { DbClient } from '../client';

/**
 * Admin analytics SQL.
 *
 * The PIN summary has three measures: `primary` (the organisation's primary
 * location), `doctor_practice` (each active practice location) and `service`
 * (each service-area PIN). The maintained `provider_pin_stats` table answers
 * the common case; filters the read model does not carry (state, district,
 * owner, dates) fall back to a live aggregation over the same definitions, so
 * both paths agree.
 *
 * Overview and staff totals are provider counts, not per-PIN counts, so they
 * include organisations that have not set a primary PIN yet.
 */

interface SummaryOptions {
  groupBy: AnalyticsGroupBy;
  page: number;
  pageSize: number;
  sort: 'pin_code' | 'total' | 'approved';
  order: 'asc' | 'desc';
  q: string | null;
  gapsOnly: boolean;
  useStats: boolean;
  measure: PinStatMeasure;
}

function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayAfter(value: string): Date {
  return new Date(dayStart(value).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Filters every query shares; `o` is `provider_organizations`.
 *
 * `requirePrimaryPin` is off for totals and staff performance: a provider that
 * has not chosen a location yet is still an onboarded provider. Per-PIN
 * summaries keep it on because a row needs a PIN.
 */
function orgWhere(filters: AnalyticsFilters, requirePrimaryPin = true): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL`];
  if (requirePrimaryPin) parts.push(Prisma.sql`o.primary_pin_code IS NOT NULL`);
  if (filters.providerType?.length) {
    parts.push(
      Prisma.sql`o.provider_type IN (${Prisma.join(
        filters.providerType.map((value) => Prisma.sql`${value}::"ProviderType"`),
      )})`,
    );
  }
  if (filters.status?.length) {
    parts.push(
      Prisma.sql`o.status IN (${Prisma.join(
        filters.status.map((value) => Prisma.sql`${value}::"ProviderOrganizationStatus"`),
      )})`,
    );
  }
  // Seeded and imported rows may only carry the PIN; fall back to the
  // directory so a state/district filter does not silently drop them.
  const stateOf = Prisma.sql`COALESCE(
    o.primary_state_id,
    (SELECT pc.state_id FROM pin_codes pc WHERE pc.pin_code = o.primary_pin_code)
  )`;
  const districtOf = Prisma.sql`COALESCE(
    o.primary_district_id,
    (SELECT pc.district_id FROM pin_codes pc WHERE pc.pin_code = o.primary_pin_code)
  )`;
  if (filters.state) parts.push(Prisma.sql`${stateOf} = ${filters.state}::uuid`);
  if (filters.district) parts.push(Prisma.sql`${districtOf} = ${filters.district}::uuid`);
  if (filters.onboardedBy)
    parts.push(Prisma.sql`o.created_by_user_id = ${filters.onboardedBy}::uuid`);
  if (filters.createdFrom) parts.push(Prisma.sql`o.created_at >= ${dayStart(filters.createdFrom)}`);
  if (filters.createdTo) parts.push(Prisma.sql`o.created_at < ${dayAfter(filters.createdTo)}`);
  return Prisma.sql`${Prisma.join(parts, ' AND ')}`;
}

function statsWhere(filters: AnalyticsFilters, measure: PinStatMeasure): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`s.measure = ${measure}::"PinStatMeasure"`,
    Prisma.sql`s.count > 0`,
  ];
  if (filters.providerType?.length) {
    parts.push(
      Prisma.sql`s.provider_type IN (${Prisma.join(
        filters.providerType.map((value) => Prisma.sql`${value}::"ProviderType"`),
      )})`,
    );
  }
  if (filters.status?.length) {
    parts.push(
      Prisma.sql`s.status IN (${Prisma.join(
        filters.status.map((value) => Prisma.sql`${value}::"ProviderOrganizationStatus"`),
      )})`,
    );
  }
  return Prisma.sql`${Prisma.join(parts, ' AND ')}`;
}

/**
 * One row per counted entity for the requested measure. The columns are always
 * `pin_code`, `provider_type`, `status`; the summary then attaches geography.
 */
function measureRows(filters: AnalyticsFilters, measure: PinStatMeasure): Prisma.Sql {
  if (measure === 'service') {
    return Prisma.sql`
      SELECT s.pin_code, o.provider_type, o.status
      FROM provider_service_pins s
      JOIN provider_organizations o ON o.id = s.organization_id
      WHERE ${orgWhere(filters, false)}
    `;
  }

  if (measure === 'doctor_practice') {
    return Prisma.sql`
      -- A doctor organisation's own practice locations.
      SELECT l.pin_code, 'doctor'::"ProviderType" AS provider_type, o.status
      FROM doctor_profiles dp
      JOIN provider_organizations o ON o.id = dp.organization_id
      JOIN doctor_locations dl
        ON dl.doctor_profile_id = dp.id
       AND dl.status = 'active'
       AND dl.location_id IS NOT NULL
      JOIN provider_locations l ON l.id = dl.location_id
      WHERE ${orgWhere(filters, false)} AND dp.deleted_at IS NULL

      UNION ALL

      -- A doctor linked to a clinic practices at the clinic's primary PIN.
      SELECT o.primary_pin_code, 'doctor'::"ProviderType", o.status
      FROM doctor_locations dl
      JOIN doctor_profiles dp ON dp.id = dl.doctor_profile_id
      JOIN provider_organizations o ON o.id = dl.clinic_organization_id
      WHERE ${orgWhere(filters, false)}
        AND o.primary_pin_code IS NOT NULL
        AND dp.deleted_at IS NULL
    `;
  }

  return Prisma.sql`
    SELECT o.primary_pin_code AS pin_code, o.provider_type, o.status
    FROM provider_organizations o
    WHERE ${orgWhere(filters, true)}
  `;
}

/**
 * The row source for a summary: one row per (group, type, status) with the
 * number of providers. Both the read model and the live path produce the same
 * columns.
 */
function summarySource(
  filters: AnalyticsFilters,
  groupBy: AnalyticsGroupBy,
  useStats: boolean,
  q: string | null,
  measure: PinStatMeasure,
): Prisma.Sql {
  if (useStats && groupBy === 'pin') {
    const prefix =
      q && /^\d{1,6}$/.test(q) ? Prisma.sql`AND s.pin_code::text LIKE ${`${q}%`}` : Prisma.empty;
    return Prisma.sql`
      SELECT s.pin_code::text AS key,
             s.pin_code AS pin_code,
             s.pin_code::text AS label,
             st.name AS state_name,
             d.name AS district_name,
             s.provider_type,
             s.status,
             s.count
      FROM provider_pin_stats s
      LEFT JOIN pin_codes pc ON pc.pin_code = s.pin_code
      LEFT JOIN districts d ON d.id = pc.district_id
      LEFT JOIN states st ON st.id = pc.state_id
      WHERE ${statsWhere(filters, measure)} ${prefix}
    `;
  }

  const labelFilter =
    q && q.length > 0
      ? Prisma.sql`AND ${
          groupBy === 'pin'
            ? Prisma.sql`r.pin_code::text LIKE ${`${q}%`}`
            : groupBy === 'district'
              ? Prisma.sql`d.name ILIKE ${`%${q}%`}`
              : Prisma.sql`st.name ILIKE ${`%${q}%`}`
        }`
      : Prisma.empty;

  if (groupBy === 'district') {
    return Prisma.sql`
      SELECT COALESCE(d.id::text, 'unknown') AS key,
             NULL::char(6) AS pin_code,
             COALESCE(d.name, 'Unknown district') AS label,
             st.name AS state_name,
             COALESCE(d.name, 'Unknown district') AS district_name,
             r.provider_type,
             r.status,
             1 AS count
      FROM (${measureRows(filters, measure)}) r
      LEFT JOIN pin_codes pc ON pc.pin_code = r.pin_code
      LEFT JOIN districts d ON d.id = pc.district_id
      LEFT JOIN states st ON st.id = d.state_id
      WHERE TRUE ${labelFilter}
    `;
  }

  if (groupBy === 'state') {
    return Prisma.sql`
      SELECT COALESCE(st.id::text, 'unknown') AS key,
             NULL::char(6) AS pin_code,
             COALESCE(st.name, 'Unknown state') AS label,
             COALESCE(st.name, 'Unknown state') AS state_name,
             NULL::text AS district_name,
             r.provider_type,
             r.status,
             1 AS count
      FROM (${measureRows(filters, measure)}) r
      LEFT JOIN pin_codes pc ON pc.pin_code = r.pin_code
      LEFT JOIN states st ON st.id = pc.state_id
      WHERE TRUE ${labelFilter}
    `;
  }

  return Prisma.sql`
    SELECT r.pin_code::text AS key,
           r.pin_code AS pin_code,
           r.pin_code::text AS label,
           st.name AS state_name,
           d.name AS district_name,
           r.provider_type,
           r.status,
           1 AS count
    FROM (${measureRows(filters, measure)}) r
    LEFT JOIN pin_codes pc ON pc.pin_code = r.pin_code
    LEFT JOIN districts d ON d.id = pc.district_id
    LEFT JOIN states st ON st.id = pc.state_id
    WHERE TRUE ${labelFilter}
  `;
}

function orderClause(options: SummaryOptions): Prisma.Sql {
  const column =
    options.sort === 'pin_code'
      ? Prisma.sql`key`
      : options.sort === 'approved'
        ? Prisma.sql`approved`
        : Prisma.sql`total`;
  const direction = options.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`ORDER BY ${column} ${direction} NULLS LAST, key ASC`;
}

async function summary(
  db: DbClient,
  filters: AnalyticsFilters,
  options: SummaryOptions,
): Promise<AnalyticsPinSummary> {
  const source = summarySource(
    filters,
    options.groupBy,
    options.useStats,
    options.q,
    options.measure,
  );
  const gapCondition = options.gapsOnly
    ? Prisma.sql`HAVING COALESCE(SUM(count) FILTER (WHERE status = 'APPROVED'), 0) = 0`
    : Prisma.empty;
  const offset = (options.page - 1) * options.pageSize;
  const sortAlias = orderClause(options);

  const rows = await db.$queryRaw<
    Array<{
      key: string;
      pin_code: string | null;
      label: string;
      state_name: string | null;
      district_name: string | null;
      total: number;
      approved: number;
    }>
  >(Prisma.sql`
    WITH src AS (${source})
    SELECT key,
           MAX(pin_code) AS pin_code,
           MAX(label) AS label,
           MAX(state_name) AS state_name,
           MAX(district_name) AS district_name,
           SUM(count)::int AS total,
           COALESCE(SUM(count) FILTER (WHERE status = 'APPROVED'), 0)::int AS approved
    FROM src
    GROUP BY key
    ${gapCondition}
    ${sortAlias}
    LIMIT ${options.pageSize} OFFSET ${offset}
  `);

  const [countRows, breakdown, totals, byType, byStatus] = await Promise.all([
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      WITH src AS (${source})
      SELECT COUNT(*)::int AS total
      FROM (SELECT key FROM src GROUP BY key ${gapCondition}) grouped
    `),
    rows.length > 0
      ? db.$queryRaw<Array<{ key: string; provider_type: string; status: string; count: number }>>(
          Prisma.sql`
            WITH src AS (${source})
            SELECT key, provider_type::text AS provider_type, status::text AS status,
                   SUM(count)::int AS count
            FROM src
            WHERE key IN (${Prisma.join(rows.map((row) => row.key))})
            GROUP BY key, provider_type, status
          `,
        )
      : Promise.resolve([]),
    db.$queryRaw<Array<{ providers: number; approved: number }>>(Prisma.sql`
      WITH src AS (${source})
      SELECT COALESCE(SUM(count), 0)::int AS providers,
             COALESCE(SUM(count) FILTER (WHERE status = 'APPROVED'), 0)::int AS approved
      FROM src
    `),
    db.$queryRaw<Array<{ provider_type: string; count: number }>>(Prisma.sql`
      WITH src AS (${source})
      SELECT provider_type::text AS provider_type, SUM(count)::int AS count
      FROM src GROUP BY provider_type ORDER BY count DESC
    `),
    db.$queryRaw<Array<{ status: string; count: number }>>(Prisma.sql`
      WITH src AS (${source})
      SELECT status::text AS status, SUM(count)::int AS count
      FROM src GROUP BY status ORDER BY count DESC
    `),
  ]);

  const byTypeMap = new Map<string, Record<string, number>>();
  const byStatusMap = new Map<string, Record<string, number>>();
  // Breakdown rows are per (type, status), so add across the other dimension.
  for (const row of breakdown) {
    const typeCounts = byTypeMap.get(row.key) ?? {};
    typeCounts[row.provider_type] = (typeCounts[row.provider_type] ?? 0) + Number(row.count);
    byTypeMap.set(row.key, typeCounts);
    const statusCounts = byStatusMap.get(row.key) ?? {};
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + Number(row.count);
    byStatusMap.set(row.key, statusCounts);
  }

  const resultRows: AnalyticsGroupRow[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    pinCode: row.pin_code,
    stateName: row.state_name,
    districtName: row.district_name,
    total: Number(row.total),
    approved: Number(row.approved),
    byType: (byTypeMap.get(row.key) ?? {}) as Partial<Record<ProviderType, number>>,
    byStatus: (byStatusMap.get(row.key) ?? {}) as Partial<Record<OrganizationStatus, number>>,
  }));

  return {
    rows: resultRows,
    totals: {
      groups: Number(countRows[0]?.total ?? 0),
      providers: Number(totals[0]?.providers ?? 0),
      approved: Number(totals[0]?.approved ?? 0),
    },
    byType: byType.map((row) => ({
      providerType: row.provider_type as ProviderType,
      count: Number(row.count),
    })),
    byStatus: byStatus.map((row) => ({
      status: row.status as OrganizationStatus,
      count: Number(row.count),
    })),
    source: options.useStats && options.groupBy === 'pin' ? 'read_model' : 'live',
    groupedBy: options.groupBy,
    measure: options.measure,
  };
}

export function createAnalyticsRepository(db: DbClient) {
  return {
    async pinSummary(
      filters: AnalyticsFilters,
      options: SummaryOptions,
    ): Promise<AnalyticsPinSummary> {
      return summary(db, filters, options);
    },

    async coverageGaps(
      filters: AnalyticsFilters,
      q: string | null,
      page: number,
      pageSize: number,
    ): Promise<AnalyticsPinSummary> {
      const prefix =
        q && /^\d{1,6}$/.test(q) ? Prisma.sql`AND p.pin_code::text LIKE ${`${q}%`}` : Prisma.empty;
      const directoryFilter = Prisma.join(
        [
          filters.state ? Prisma.sql`AND p.state_id = ${filters.state}::uuid` : Prisma.empty,
          filters.district
            ? Prisma.sql`AND p.district_id = ${filters.district}::uuid`
            : Prisma.empty,
        ],
        ' ',
      );
      const where = orgWhere(filters);
      const offset = (page - 1) * pageSize;

      // The directory drives the list: a PIN with no providers at all is the
      // most important gap, so this cannot start from the provider table.
      const rows = await db.$queryRaw<
        Array<{
          pin_code: string;
          state_name: string | null;
          district_name: string | null;
          providers: number;
        }>
      >(Prisma.sql`
        SELECT p.pin_code,
               st.name AS state_name,
               d.name AS district_name,
               COALESCE(a.providers, 0)::int AS providers
        FROM pin_codes p
        LEFT JOIN districts d ON d.id = p.district_id
        LEFT JOIN states st ON st.id = p.state_id
        LEFT JOIN (
          SELECT o.primary_pin_code AS pin_code, COUNT(*)::int AS providers
          FROM provider_organizations o
          WHERE ${where}
          GROUP BY o.primary_pin_code
          HAVING COUNT(*) FILTER (WHERE o.status = 'APPROVED') = 0
        ) a ON a.pin_code = p.pin_code
        WHERE p.is_active = TRUE ${prefix} ${directoryFilter}
        ORDER BY p.pin_code ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countRows = await db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM pin_codes p
        LEFT JOIN (
          SELECT o.primary_pin_code AS pin_code
          FROM provider_organizations o
          WHERE ${where}
          GROUP BY o.primary_pin_code
          HAVING COUNT(*) FILTER (WHERE o.status = 'APPROVED') > 0
        ) approved ON approved.pin_code = p.pin_code
        WHERE p.is_active = TRUE AND approved.pin_code IS NULL ${prefix} ${directoryFilter}
      `);

      const totalRow = await db.$queryRaw<Array<{ providers: number }>>(Prisma.sql`
        SELECT COALESCE(SUM(providers), 0)::int AS providers
        FROM (
          SELECT COUNT(*)::int AS providers
          FROM provider_organizations o
          WHERE ${where} AND o.status <> 'APPROVED'
          GROUP BY o.primary_pin_code
        ) counts
      `);

      return {
        rows: rows.map((row) => ({
          key: row.pin_code,
          label: row.pin_code,
          pinCode: row.pin_code,
          stateName: row.state_name,
          districtName: row.district_name,
          total: Number(row.providers),
          approved: 0,
          byType: {},
          byStatus: {},
        })),
        totals: {
          groups: Number(countRows[0]?.total ?? 0),
          providers: Number(totalRow[0]?.providers ?? 0),
          approved: 0,
        },
        byType: [],
        byStatus: [],
        source: 'live',
        groupedBy: 'pin',
        measure: 'primary',
      };
    },

    async overview(filters: AnalyticsFilters, days: number): Promise<AnalyticsOverview> {
      const where = orgWhere(filters, false);
      const [totals, perDay, byType, byStatus] = await Promise.all([
        db.$queryRaw<
          Array<{
            providers: number;
            approved: number;
            drafts: number;
            submitted: number;
            under_review: number;
            changes_requested: number;
            rejected: number;
            suspended: number;
            terminated: number;
            ever_submitted: number;
            ever_approved: number;
            average_review_days: number | null;
          }>
        >(Prisma.sql`
          SELECT COUNT(*)::int AS providers,
                 COUNT(*) FILTER (WHERE o.status = 'APPROVED')::int AS approved,
                 COUNT(*) FILTER (WHERE o.status = 'DRAFT')::int AS drafts,
                 COUNT(*) FILTER (WHERE o.status = 'SUBMITTED')::int AS submitted,
                 COUNT(*) FILTER (WHERE o.status = 'UNDER_REVIEW')::int AS under_review,
                 COUNT(*) FILTER (WHERE o.status = 'CHANGES_REQUESTED')::int AS changes_requested,
                 COUNT(*) FILTER (WHERE o.status = 'REJECTED')::int AS rejected,
                 COUNT(*) FILTER (WHERE o.status = 'SUSPENDED')::int AS suspended,
                 COUNT(*) FILTER (WHERE o.status = 'TERMINATED')::int AS terminated,
                 COUNT(*) FILTER (WHERE o.submitted_at IS NOT NULL)::int AS ever_submitted,
                 COUNT(*) FILTER (WHERE o.approved_at IS NOT NULL)::int AS ever_approved,
                 AVG(EXTRACT(EPOCH FROM (o.approved_at - o.submitted_at)) / 86400.0)::float
                   AS average_review_days
          FROM provider_organizations o
          WHERE ${where}
        `),
        db.$queryRaw<Array<{ date: string; count: number }>>(Prisma.sql`
          SELECT to_char(day, 'YYYY-MM-DD') AS date, COUNT(o.id)::int AS count
          FROM generate_series(
                 CURRENT_DATE - ((${days - 1})::int * interval '1 day'),
                 CURRENT_DATE,
                 interval '1 day'
               ) AS day
          LEFT JOIN provider_organizations o
            ON o.created_at >= day AND o.created_at < day + interval '1 day'
           AND ${where}
          GROUP BY day
          ORDER BY day
        `),
        db.$queryRaw<Array<{ provider_type: string; count: number }>>(Prisma.sql`
          SELECT o.provider_type::text AS provider_type, COUNT(*)::int AS count
          FROM provider_organizations o WHERE ${where}
          GROUP BY o.provider_type ORDER BY count DESC
        `),
        db.$queryRaw<Array<{ status: string; count: number }>>(Prisma.sql`
          SELECT o.status::text AS status, COUNT(*)::int AS count
          FROM provider_organizations o WHERE ${where}
          GROUP BY o.status ORDER BY count DESC
        `),
      ]);

      const row = totals[0];
      return {
        totals: {
          providers: Number(row?.providers ?? 0),
          approved: Number(row?.approved ?? 0),
          drafts: Number(row?.drafts ?? 0),
          submitted: Number(row?.submitted ?? 0),
          underReview: Number(row?.under_review ?? 0),
          changesRequested: Number(row?.changes_requested ?? 0),
          rejected: Number(row?.rejected ?? 0),
          suspended: Number(row?.suspended ?? 0),
          terminated: Number(row?.terminated ?? 0),
        },
        funnel: {
          draft: Number(row?.drafts ?? 0),
          submitted: Number(row?.ever_submitted ?? 0),
          approved: Number(row?.ever_approved ?? 0),
          rejected: Number(row?.rejected ?? 0),
        },
        averageReviewDays:
          row?.average_review_days === null || row?.average_review_days === undefined
            ? null
            : Math.round(Number(row.average_review_days) * 10) / 10,
        byType: byType.map((entry) => ({
          providerType: entry.provider_type as ProviderType,
          count: Number(entry.count),
        })),
        byStatus: byStatus.map((entry) => ({
          status: entry.status as OrganizationStatus,
          count: Number(entry.count),
        })),
        perDay: perDay.map((entry) => ({ date: entry.date, count: Number(entry.count) })),
      };
    },

    async staffPerformance(
      filters: AnalyticsFilters,
      page: number,
      pageSize: number,
    ): Promise<StaffPerformanceResult> {
      const where = orgWhere(filters, false);
      const offset = (page - 1) * pageSize;
      const [rows, countRows] = await Promise.all([
        db.$queryRaw<
          Array<{
            staff_user_id: string;
            name: string;
            email: string;
            created: number;
            submitted: number;
            approved: number;
            rejected: number;
            average_completion_days: number | null;
          }>
        >(Prisma.sql`
          SELECT u.id AS staff_user_id,
                 u.name,
                 u.email,
                 COUNT(o.id)::int AS created,
                 COUNT(o.id) FILTER (WHERE o.submitted_at IS NOT NULL)::int AS submitted,
                 COUNT(o.id) FILTER (WHERE o.approved_at IS NOT NULL)::int AS approved,
                 COUNT(o.id) FILTER (WHERE o.status = 'REJECTED')::int AS rejected,
                 AVG(EXTRACT(EPOCH FROM (o.approved_at - o.created_at)) / 86400.0)::float
                   AS average_completion_days
          FROM users u
          JOIN provider_organizations o ON o.created_by_user_id = u.id
          WHERE ${where}
          GROUP BY u.id, u.name, u.email
          ORDER BY created DESC, u.name ASC
          LIMIT ${pageSize} OFFSET ${offset}
        `),
        db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
          SELECT COUNT(DISTINCT o.created_by_user_id)::int AS total
          FROM provider_organizations o
          WHERE ${where} AND o.created_by_user_id IS NOT NULL
        `),
      ]);

      return {
        rows: rows.map((row) => ({
          staffUserId: row.staff_user_id,
          name: row.name,
          email: row.email,
          created: Number(row.created),
          submitted: Number(row.submitted),
          approved: Number(row.approved),
          rejected: Number(row.rejected),
          averageCompletionDays:
            row.average_completion_days === null || row.average_completion_days === undefined
              ? null
              : Math.round(Number(row.average_completion_days) * 10) / 10,
        })),
        meta: {
          page,
          pageSize,
          total: Number(countRows[0]?.total ?? 0),
          totalPages: Math.max(1, Math.ceil(Number(countRows[0]?.total ?? 0) / pageSize)),
        },
      };
    },
  };
}
