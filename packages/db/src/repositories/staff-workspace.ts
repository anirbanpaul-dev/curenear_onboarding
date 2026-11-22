import { Prisma } from '@prisma/client';
import type {
  StaffActivityRecord,
  StaffChangeRequestRecord,
  StaffExpiryRecord,
  StaffWorkspaceRepository,
} from '@curenear/shared';
import type { DbClient } from '../client';

/**
 * The staff dashboard read models.
 *
 * Every query joins `provider_organizations` on `created_by_user_id`, so an
 * owner id is part of the SQL and a scoping mistake cannot be fixed by the
 * caller afterwards.
 */

function changeRequestSql(
  ownerUserId: string,
  organizationIds: string[] | null,
  limit: number,
): Prisma.Sql {
  const idFilter = organizationIds
    ? Prisma.sql`AND h.organization_id IN (${Prisma.join(
        organizationIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`
    : Prisma.empty;
  return Prisma.sql`
    SELECT * FROM (
      SELECT DISTINCT ON (h.organization_id)
             h.organization_id AS "organizationId",
             o.code AS "organizationCode",
             o.legal_name AS "organizationName",
             h.reason AS comment,
             h.at AS "at",
             u.name AS "requestedByName"
      FROM provider_status_history h
      JOIN provider_organizations o ON o.id = h.organization_id
      LEFT JOIN users u ON u.id = h.changed_by_user_id
      WHERE o.created_by_user_id = ${ownerUserId}::uuid
        AND o.deleted_at IS NULL
        AND h.to_status = 'CHANGES_REQUESTED'
        AND h.reason IS NOT NULL
        ${idFilter}
      ORDER BY h.organization_id, h.at DESC
    ) latest
    ORDER BY latest."at" DESC
    LIMIT ${limit}
  `;
}

export function createStaffWorkspaceRepository(db: DbClient): StaffWorkspaceRepository {
  return {
    async changeRequests(ownerUserId, limit) {
      return db.$queryRaw<StaffChangeRequestRecord[]>(changeRequestSql(ownerUserId, null, limit));
    },

    async changeRequestsFor(ownerUserId, organizationIds) {
      if (organizationIds.length === 0) return [];
      return db.$queryRaw<StaffChangeRequestRecord[]>(
        changeRequestSql(ownerUserId, organizationIds, organizationIds.length),
      );
    },

    async expiring(ownerUserId, before, limit) {
      return db.$queryRaw<StaffExpiryRecord[]>(Prisma.sql`
        SELECT * FROM (
          SELECT o.id AS "organizationId",
                 o.code AS "organizationCode",
                 o.legal_name AS "organizationName",
                 'licence' AS "kind",
                 CONCAT('Licence ', l.number) AS "label",
                 l.valid_to AS "expiresOn"
          FROM provider_licences l
          JOIN provider_organizations o ON o.id = l.organization_id
          WHERE o.created_by_user_id = ${ownerUserId}::uuid
            AND o.deleted_at IS NULL
            AND l.valid_to IS NOT NULL
            AND l.valid_to <= ${before}::date
          UNION ALL
          SELECT o.id,
                 o.code,
                 o.legal_name,
                 'insurance',
                 CONCAT(i.type, ' · ', i.policy_no),
                 i.valid_to
          FROM provider_insurance i
          JOIN provider_organizations o ON o.id = i.organization_id
          WHERE o.created_by_user_id = ${ownerUserId}::uuid
            AND o.deleted_at IS NULL
            AND i.valid_to IS NOT NULL
            AND i.valid_to <= ${before}::date
        ) expiring
        ORDER BY "expiresOn" ASC
        LIMIT ${limit}
      `);
    },

    async recentActivity(ownerUserId, limit) {
      return db.$queryRaw<StaffActivityRecord[]>(Prisma.sql`
        SELECT a.id,
               a.action,
               a.entity_id AS "organizationId",
               o.legal_name AS "organizationName",
               a.created_at AS "at",
               a.actor_role::text AS "actorRole"
        FROM audit_logs a
        JOIN provider_organizations o ON o.id = a.entity_id::uuid
        WHERE o.created_by_user_id = ${ownerUserId}::uuid
          AND o.deleted_at IS NULL
          AND a.entity_type = 'provider_organization'
        ORDER BY a.created_at DESC
        LIMIT ${limit}
      `);
    },

    async monthlyCounts(ownerUserId, from) {
      const rows = await db.$queryRaw<Array<{ month: string; count: number }>>(Prisma.sql`
        SELECT to_char(date_trunc('month', o.created_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS count
        FROM provider_organizations o
        WHERE o.created_by_user_id = ${ownerUserId}::uuid
          AND o.deleted_at IS NULL
          AND o.created_at >= ${from}
        GROUP BY 1
        ORDER BY 1
      `);
      return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
    },
  };
}
