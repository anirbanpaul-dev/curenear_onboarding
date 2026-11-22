import { Prisma } from '@prisma/client';
import {
  type AdminProviderDirectoryRow,
  type AdminProviderFacets,
  type AdminProviderFilters,
  type AdminProviderSortField,
  type ProviderDirectoryViewRecord,
  type ProviderDirectoryRepository,
  type ProviderType,
} from '@curenear/shared';
import type { DbClient } from '../client';

/**
 * The admin provider directory read model.
 *
 * One SQL statement serves the page, a second counts the filtered set (so the
 * total is right even past the last page) and two grouped statements provide the
 * type/status facets. Everything is index-driven; `docs/decisions.md` records
 * the EXPLAIN plans and the 100,000-provider measurements.
 */

/** Only these sort columns can be NULL; the others order without a NULLS
 * clause so the covering index supplies the ordering directly. */
const sortCanBeNull: Record<AdminProviderSortField, boolean> = {
  created_at: false,
  updated_at: false,
  submitted_at: true,
  legal_name: true,
  status: false,
  provider_type: false,
  code: false,
  primary_pin_code: true,
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function pinClause(pins: string[]): Prisma.Sql | null {
  if (pins.length === 0) return null;
  // A 6-digit entry is exact; shorter entries are prefixes. Both are `LIKE`
  // patterns so the expression index with text_pattern_ops serves them.
  const parts = pins.map((pin) => Prisma.sql`o.primary_pin_code::text LIKE ${`${pin}%`}`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function whereSql(filters: AdminProviderFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL`];

  if (filters.providerTypes.length > 0) {
    const values = filters.providerTypes.map((type) => Prisma.sql`${type}::"ProviderType"`);
    conditions.push(Prisma.sql`o.provider_type IN (${Prisma.join(values)})`);
  }
  if (filters.statuses.length > 0) {
    const values = filters.statuses.map(
      (status) => Prisma.sql`${status}::"ProviderOrganizationStatus"`,
    );
    conditions.push(Prisma.sql`o.status IN (${Prisma.join(values)})`);
  }

  const pins = pinClause(filters.pins);
  if (pins) conditions.push(pins);

  if (filters.stateId) conditions.push(Prisma.sql`o.primary_state_id = ${filters.stateId}::uuid`);
  if (filters.districtId) {
    conditions.push(Prisma.sql`o.primary_district_id = ${filters.districtId}::uuid`);
  }
  if (filters.onboardedByUserId) {
    conditions.push(Prisma.sql`o.created_by_user_id = ${filters.onboardedByUserId}::uuid`);
  }
  if (filters.createdFrom) conditions.push(Prisma.sql`o.created_at >= ${filters.createdFrom}`);
  if (filters.createdBefore) conditions.push(Prisma.sql`o.created_at < ${filters.createdBefore}`);
  if (filters.submittedFrom) {
    conditions.push(Prisma.sql`o.submitted_at >= ${filters.submittedFrom}`);
  }
  if (filters.submittedBefore) {
    conditions.push(Prisma.sql`o.submitted_at < ${filters.submittedBefore}`);
  }
  if (filters.licenceExpiringDays !== null) {
    const days = filters.licenceExpiringDays;
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM provider_licences l
      WHERE l.organization_id = o.id
        AND l.valid_to IS NOT NULL
        AND l.valid_to >= CURRENT_DATE
        AND l.valid_to <= CURRENT_DATE + ${days}::int
    )`);
  }
  if (filters.missingDocuments !== null) {
    // Maintained by triggers (migration 20260425000100), so this is an indexed
    // column instead of a document anti-join per provider.
    conditions.push(Prisma.sql`o.document_gap = ${filters.missingDocuments}`);
  }
  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    conditions.push(Prisma.sql`(
      o.legal_name ILIKE ${pattern} ESCAPE '\\'
      OR o.trade_name ILIKE ${pattern} ESCAPE '\\'
      OR o.mobile ILIKE ${pattern} ESCAPE '\\'
      OR o.registration_number ILIKE ${pattern} ESCAPE '\\'
      OR o.code ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  return Prisma.join(conditions, ' AND ');
}

function orderSql(sort: { field: AdminProviderSortField; order: 'asc' | 'desc' }): Prisma.Sql {
  const direction = Prisma.raw(sort.order === 'asc' ? 'ASC' : 'DESC');
  // `sort.field` is a closed enum whose values are the column names, so it is
  // safe as an identifier; never pass user input here.
  const column = Prisma.raw(sort.field);
  // The joined tables (users, states, districts) also have `created_at` and
  // `id`, so the order has to name the provider table explicitly.
  return sortCanBeNull[sort.field]
    ? Prisma.sql`o.${column} ${direction} NULLS LAST, o.id ASC`
    : Prisma.sql`o.${column} ${direction}, o.id ASC`;
}

interface RawRow {
  id: string;
  code: string;
  providerType: string;
  status: string;
  legalName: string | null;
  tradeName: string | null;
  mobile: string | null;
  registrationNumber: string | null;
  primaryPinCode: string | null;
  stateName: string | null;
  districtName: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdByEmail: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  documentCount: number;
  earliestLicenceExpiry: Date | null;
}

function mapRow(row: RawRow): AdminProviderDirectoryRow {
  return {
    id: row.id,
    code: row.code,
    providerType: row.providerType as ProviderType,
    status: row.status as AdminProviderDirectoryRow['status'],
    legalName: row.legalName,
    tradeName: row.tradeName,
    mobile: row.mobile,
    registrationNumber: row.registrationNumber,
    primaryPinCode: row.primaryPinCode,
    stateName: row.stateName,
    districtName: row.districtName,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdByEmail: row.createdByEmail,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    documentCount: Number(row.documentCount),
    earliestLicenceExpiry: row.earliestLicenceExpiry,
  };
}

function mapView(row: {
  id: string;
  userId: string;
  name: string;
  query: string;
  createdAt: Date;
  updatedAt: Date;
}): ProviderDirectoryViewRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    query: row.query,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createProviderDirectoryRepository(db: DbClient): ProviderDirectoryRepository {
  return {
    async search(filters, page, sort) {
      const where = whereSql(filters);

      const [rows, totalRows] = await Promise.all([
        db.$queryRaw<RawRow[]>(Prisma.sql`
          SELECT o.id,
                 o.code,
                 o.provider_type::text AS "providerType",
                 o.status::text AS "status",
                 o.legal_name AS "legalName",
                 o.trade_name AS "tradeName",
                 o.mobile,
                 o.registration_number AS "registrationNumber",
                 o.primary_pin_code::text AS "primaryPinCode",
                 st.name AS "stateName",
                 dst.name AS "districtName",
                 o.created_by_user_id AS "createdByUserId",
                 u.name AS "createdByName",
                 u.email AS "createdByEmail",
                 o.submitted_at AS "submittedAt",
                 o.created_at AS "createdAt",
                 o.updated_at AS "updatedAt",
                 o.version,
                 (
                   SELECT count(*)::int FROM provider_documents d
                   WHERE d.organization_id = o.id AND d.deleted_at IS NULL
                 ) AS "documentCount",
                 lic.earliest AS "earliestLicenceExpiry"
          FROM provider_organizations o
          LEFT JOIN users u ON u.id = o.created_by_user_id
          LEFT JOIN states st ON st.id = o.primary_state_id
          LEFT JOIN districts dst ON dst.id = o.primary_district_id
          LEFT JOIN LATERAL (
            SELECT min(l.valid_to) AS earliest
            FROM provider_licences l
            WHERE l.organization_id = o.id
          ) lic ON TRUE
          WHERE ${where}
          ORDER BY ${orderSql(sort)}
          LIMIT ${page.take} OFFSET ${page.skip}
        `),
        db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
          SELECT count(*)::int AS total FROM provider_organizations o WHERE ${where}
        `),
      ]);

      return { rows: rows.map(mapRow), total: Number(totalRows[0]?.total ?? 0) };
    },

    async facets(filters) {
      const where = whereSql(filters);
      const [typeRows, statusRows] = await Promise.all([
        db.$queryRaw<Array<{ value: string; count: number }>>(Prisma.sql`
          SELECT o.provider_type::text AS value, count(*)::int AS count
          FROM provider_organizations o
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `),
        db.$queryRaw<Array<{ value: string; count: number }>>(Prisma.sql`
          SELECT o.status::text AS value, count(*)::int AS count
          FROM provider_organizations o
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `),
      ]);

      return {
        byType: typeRows.map((row) => ({
          providerType: row.value as ProviderType,
          count: Number(row.count),
        })),
        byStatus: statusRows.map((row) => ({
          status: row.value as AdminProviderFacets['byStatus'][number]['status'],
          count: Number(row.count),
        })),
      } satisfies AdminProviderFacets;
    },

    async listViews(userId) {
      const rows = await db.providerDirectoryView.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
      });
      return rows.map(mapView);
    },

    async saveView(input) {
      const row = await db.providerDirectoryView.upsert({
        where: { userId_name: { userId: input.userId, name: input.name } },
        create: {
          id: input.id,
          userId: input.userId,
          name: input.name,
          query: input.query,
        },
        update: { query: input.query },
      });
      return mapView(row);
    },

    async deleteView(userId, id) {
      const result = await db.providerDirectoryView.deleteMany({ where: { id, userId } });
      return result.count > 0;
    },
  };
}
