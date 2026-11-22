import { Prisma } from '@prisma/client';
import type {
  OrganizationStatus,
  ProviderType,
  ReviewChecklistProgress,
  ReviewCommentDto,
  ReviewRepository,
  ReviewVerificationDto,
  SuspensionScope,
} from '@curenear/shared';
import type { DbClient } from '../client';

/**
 * Persistence for the admin review workflow: the SUBMITTED queue, the
 * verification checklist (`verification_records`), section comments, reviewer
 * assignment and the configurable SLA thresholds.
 */

const ROW_SELECT = Prisma.sql`
  SELECT o.id,
         o.code,
         o.legal_name AS "legalName",
         o.provider_type::text AS "providerType",
         o.status::text AS status,
         o.primary_pin_code AS "primaryPinCode",
         o.submitted_at AS "submittedAt",
         u.id AS "staffId",
         u.name AS "staffName",
         u.email AS "staffEmail",
         ra.reviewer_user_id AS "reviewerId",
         ru.name AS "reviewerName",
         COALESCE(v.total, 0)::int AS total,
         COALESCE(v.required, 0)::int AS required,
         COALESCE(v.verified, 0)::int AS verified,
         COALESCE(v.not_applicable, 0)::int AS "notApplicable",
         COALESCE(v.pending, 0)::int AS pending,
                    COALESCE(v.rejected, 0)::int AS rejected,
           COALESCE(v.expired, 0)::int AS expired,
           COALESCE(v.blocking, 0)::int AS blocking
  FROM provider_organizations o
  LEFT JOIN users u ON u.id = o.created_by_user_id
  LEFT JOIN review_assignments ra ON ra.organization_id = o.id
  LEFT JOIN users ru ON ru.id = ra.reviewer_user_id
  LEFT JOIN (
    SELECT organization_id,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE required) AS required,
           COUNT(*) FILTER (WHERE status = 'VERIFIED') AS verified,
           COUNT(*) FILTER (WHERE status = 'NOT_APPLICABLE') AS not_applicable,
           COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
           COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
           COUNT(*) FILTER (WHERE status = 'EXPIRED') AS expired,
           COUNT(*) FILTER (WHERE required AND status NOT IN ('VERIFIED', 'NOT_APPLICABLE'))
             AS blocking
    FROM verification_records
    WHERE organization_id IS NOT NULL
    GROUP BY organization_id
  ) v ON v.organization_id = o.id
`;

function checklist(input: {
  total: number;
  required: number;
  verified: number;
  notApplicable: number;
  pending: number;
  rejected: number;
  expired: number;
  blocking: number;
}): ReviewChecklistProgress {
  return {
    total: Number(input.total),
    required: Number(input.required),
    verified: Number(input.verified),
    notApplicable: Number(input.notApplicable),
    pending: Number(input.pending),
    rejected: Number(input.rejected),
    expired: Number(input.expired),
    blocking: Math.max(0, Number(input.blocking)),
  };
}

type ReviewVerificationRow = {
  id: string;
  item: string;
  section_key: string | null;
  required: boolean;
  status: string;
  verified_by: string | null;
  verified_at: Date | null;
  source: string | null;
  evidence_ref: string | null;
  reason: string | null;
  next_verification_on: Date | null;
  label: string | null;
};

function mapVerification(row: ReviewVerificationRow): ReviewVerificationDto {
  return {
    id: row.id,
    item: row.item,
    label: row.label ?? row.item.replace(/_/g, ' '),
    sectionKey: row.section_key,
    required: row.required,
    status: row.status as ReviewVerificationDto['status'],
    verifiedByUserId: row.verified_by,
    verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
    source: row.source,
    evidenceRef: row.evidence_ref,
    reason: row.reason,
    nextVerificationOn: row.next_verification_on
      ? row.next_verification_on.toISOString().slice(0, 10)
      : null,
  };
}

const VERIFICATION_SELECT = Prisma.sql`
  SELECT id, item, section_key, required, status::text AS status, verified_by,
         verified_at, source, evidence_ref, reason, next_verification_on, NULL::text AS label
  FROM verification_records
`;

export function createReviewRepository(db: DbClient): ReviewRepository {
  return {
    async queue(filters, page, pageSize) {
      const parts: Prisma.Sql[] = [
        Prisma.sql`o.deleted_at IS NULL`,
        Prisma.sql`o.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
      ];
      if (filters.providerTypes.length > 0) {
        parts.push(
          Prisma.sql`o.provider_type IN (${Prisma.join(
            filters.providerTypes.map((value) => Prisma.sql`${value}::"ProviderType"`),
          )})`,
        );
      }
      if (filters.pin) {
        parts.push(Prisma.sql`o.primary_pin_code::text LIKE ${`${filters.pin}%`}`);
      }
      if (filters.staffUserId) {
        parts.push(Prisma.sql`o.created_by_user_id = ${filters.staffUserId}::uuid`);
      }
      if (filters.assignedToUserId) {
        parts.push(Prisma.sql`ra.reviewer_user_id = ${filters.assignedToUserId}::uuid`);
      }
      const where = Prisma.sql`${Prisma.join(parts, ' AND ')}`;
      const offset = (page - 1) * pageSize;

      const rows = await db.$queryRaw<
        Array<{
          id: string;
          code: string;
          legalName: string | null;
          providerType: string;
          status: string;
          primaryPinCode: string | null;
          submittedAt: Date | null;
          staffId: string | null;
          staffName: string | null;
          staffEmail: string | null;
          reviewerId: string | null;
          reviewerName: string | null;
          total: number;
          required: number;
          verified: number;
          notApplicable: number;
          pending: number;
          rejected: number;
          expired: number;
          blocking: number;
        }>
      >(Prisma.sql`
        ${ROW_SELECT}
        WHERE ${where}
        ORDER BY o.submitted_at ASC NULLS LAST, o.created_at ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const counts = await db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM provider_organizations o
        LEFT JOIN review_assignments ra ON ra.organization_id = o.id
        WHERE ${where}
      `);

      return {
        total: Number(counts[0]?.total ?? 0),
        rows: rows.map((row) => ({
          id: row.id,
          code: row.code,
          legalName: row.legalName,
          providerType: row.providerType as ProviderType,
          status: row.status as OrganizationStatus,
          primaryPinCode: row.primaryPinCode,
          submittedAt: row.submittedAt,
          staff:
            row.staffId && row.staffName && row.staffEmail
              ? { id: row.staffId, name: row.staffName, email: row.staffEmail }
              : null,
          assignedTo:
            row.reviewerId && row.reviewerName
              ? { id: row.reviewerId, name: row.reviewerName }
              : null,
          checklist: checklist({
            total: Number(row.total),
            required: Number(row.required),
            verified: Number(row.verified),
            notApplicable: Number(row.notApplicable),
            pending: Number(row.pending),
            rejected: Number(row.rejected),
            expired: Number(row.expired),
            blocking: Number(row.blocking),
          }),
        })),
      };
    },

    async settings() {
      const row = await db.reviewSettings.findUnique({ where: { id: 'default' } });
      return {
        warnHours: row?.slaWarnHours ?? 48,
        breachHours: row?.slaBreachHours ?? 72,
        updatedAt: row?.updatedAt ?? null,
      };
    },

    async saveSettings(input, userId) {
      const row = await db.reviewSettings.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          slaWarnHours: input.warnHours,
          slaBreachHours: input.breachHours,
          updatedByUserId: userId,
        },
        update: {
          slaWarnHours: input.warnHours,
          slaBreachHours: input.breachHours,
          updatedByUserId: userId,
        },
      });
      return {
        warnHours: row.slaWarnHours,
        breachHours: row.slaBreachHours,
        updatedAt: row.updatedAt,
      };
    },

    async assign(organizationId, reviewerUserId, assignedByUserId) {
      await db.reviewAssignment.upsert({
        where: { organizationId },
        create: { organizationId, reviewerUserId, assignedByUserId },
        update: { reviewerUserId, assignedByUserId, assignedAt: new Date() },
      });
    },

    async assignment(organizationId) {
      const row = await db.reviewAssignment.findUnique({ where: { organizationId } });
      if (!row) return null;
      const user = await db.user.findUnique({
        where: { id: row.reviewerUserId },
        select: { name: true },
      });
      return {
        reviewerUserId: row.reviewerUserId,
        reviewerName: user?.name ?? 'Unknown reviewer',
        assignedAt: row.assignedAt,
      };
    },

    async verifications(organizationId) {
      const rows = await db.$queryRaw<ReviewVerificationRow[]>(Prisma.sql`
        ${VERIFICATION_SELECT}
        WHERE organization_id = ${organizationId}::uuid
        ORDER BY required DESC, section_key ASC NULLS LAST, item ASC
      `);
      return rows.map(mapVerification);
    },

    async doctorVerifications(doctorProfileId) {
      const rows = await db.$queryRaw<ReviewVerificationRow[]>(Prisma.sql`
        ${VERIFICATION_SELECT}
        WHERE doctor_profile_id = ${doctorProfileId}::uuid
        ORDER BY item ASC
      `);
      return rows.map(mapVerification);
    },

    async seed(organizationId, items) {
      if (items.length === 0) return 0;
      const result = await db.reviewVerification.createMany({
        data: items.map((item) => ({
          organizationId,
          item: item.code,
          sectionKey: item.sectionKey,
          required: item.required,
        })),
        skipDuplicates: true,
      });
      return result.count;
    },

    async seedDoctor(doctorProfileId, items) {
      if (items.length === 0) return 0;
      const result = await db.reviewVerification.createMany({
        data: items.map((item) => ({
          doctorProfileId,
          item: item.code,
          sectionKey: item.sectionKey,
          required: item.required,
        })),
        skipDuplicates: true,
      });
      return result.count;
    },

    async updateVerification(organizationId, item, input, actorUserId, at) {
      const settled = input.status !== 'PENDING';
      const updated = await db.reviewVerification.updateMany({
        where: { organizationId, item },
        data: {
          status: input.status,
          verifiedByUserId: settled ? actorUserId : null,
          verifiedAt: settled ? at : null,
          source: input.source ?? null,
          evidenceRef: input.evidence_ref ?? null,
          reason: input.reason ?? null,
          nextVerificationOn: input.next_verification_on
            ? new Date(`${input.next_verification_on}T00:00:00.000Z`)
            : null,
        },
      });
      if (updated.count === 0) {
        throw new Error('VERIFICATION_NOT_FOUND');
      }
      const rows = await db.$queryRaw<ReviewVerificationRow[]>(Prisma.sql`
        ${VERIFICATION_SELECT}
        WHERE organization_id = ${organizationId}::uuid AND item = ${item}
      `);
      return mapVerification(rows[0]!);
    },

    async resetItems(organizationId, items) {
      if (items.length === 0) return 0;
      const result = await db.reviewVerification.updateMany({
        where: {
          organizationId,
          item: { in: items },
          status: { in: ['VERIFIED', 'REJECTED', 'EXPIRED'] },
        },
        data: {
          status: 'PENDING',
          verifiedByUserId: null,
          verifiedAt: null,
          source: null,
          evidenceRef: null,
          reason: null,
          nextVerificationOn: null,
        },
      });
      return result.count;
    },

    async comments(organizationId) {
      const rows = await db.$queryRaw<
        Array<{
          id: string;
          section_key: string;
          body: string;
          author_user_id: string;
          author_role: string;
          created_at: Date;
          author_name: string | null;
        }>
      >(Prisma.sql`
        SELECT c.id, c.section_key, c.body, c.author_user_id, c.author_role, c.created_at,
               u.name AS author_name
        FROM review_comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.organization_id = ${organizationId}::uuid
        ORDER BY c.created_at ASC
      `);
      return rows.map((row): ReviewCommentDto => ({
        id: row.id,
        sectionKey: row.section_key,
        body: row.body,
        authorUserId: row.author_user_id,
        authorName: row.author_name ?? 'Unknown user',
        authorRole: row.author_role,
        createdAt: row.created_at.toISOString(),
      }));
    },

    async addComment(input) {
      await db.reviewComment.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          sectionKey: input.sectionKey,
          authorUserId: input.authorUserId,
          authorRole: input.authorRole,
          body: input.body,
          createdAt: input.at,
        },
      });
      const author = await db.user.findUnique({
        where: { id: input.authorUserId },
        select: { name: true },
      });
      return {
        id: input.id,
        sectionKey: input.sectionKey,
        body: input.body,
        authorUserId: input.authorUserId,
        authorName: author?.name ?? 'Unknown user',
        authorRole: input.authorRole,
        createdAt: input.at.toISOString(),
      };
    },

    async lastSuspension(organizationId) {
      const rows = await db.$queryRaw<
        Array<{ scope: string | null; scope_label: string | null; reason: string | null }>
      >(Prisma.sql`
        SELECT scope::text AS scope, scope_label, reason
        FROM provider_status_history
        WHERE organization_id = ${organizationId}::uuid AND to_status = 'SUSPENDED'
        ORDER BY at DESC
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return null;
      return {
        scope: row.scope as SuspensionScope | null,
        scopeLabel: row.scope_label,
        reason: row.reason,
      };
    },
  };
}
