import {
  pageMeta,
  type Actor,
  type AdminProviderFilters,
  type AdminProviderListQuery,
  type StaffDashboard,
  type StaffDraftAttention,
  type StaffProviderListQuery,
  type StaffProviderRow,
} from '@curenear/shared';
import { toAdminProviderFilters } from './admin-directory-service';
import type { createProviderOnboardingService } from './provider-onboarding-service';
import type { ServiceDeps } from './service-deps';

/**
 * The staff workspace.
 *
 * Every read is scoped to `created_by_user_id = actor.userId` inside the
 * service, so no query string or provider id can widen it. Provider detail,
 * documents, consents and transitions keep going through the onboarding
 * service, whose owner check returns 404 for any other staff member's records.
 */

const DRAFT_SAMPLE = 24;
const DASHBOARD_LIMIT = 6;
const EXPIRY_WINDOW_DAYS = 60;

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function baseFilters(actor: Actor): AdminProviderFilters {
  return {
    providerTypes: [],
    statuses: [],
    pins: [],
    stateId: null,
    districtId: null,
    onboardedByUserId: actor.userId,
    createdFrom: null,
    createdBefore: null,
    submittedFrom: null,
    submittedBefore: null,
    licenceExpiringDays: null,
    missingDocuments: null,
    search: null,
  };
}

export interface StaffProviderListResult {
  rows: StaffProviderRow[];
  facets: Awaited<ReturnType<ServiceDeps['repositories']['directory']['facets']>>;
  meta: ReturnType<typeof pageMeta>;
}

export function createStaffWorkspaceService(
  deps: Pick<ServiceDeps, 'repositories' | 'now'> & {
    onboarding: ReturnType<typeof createProviderOnboardingService>;
  },
) {
  const { repositories, onboarding, now } = deps;

  /** One extra query attaches the change-request comment shown in the list. */
  async function withChangeRequests(
    actor: Actor,
    rows: Array<Omit<StaffProviderRow, 'changeRequest'>>,
  ): Promise<StaffProviderRow[]> {
    const requests = await repositories.staffWorkspace.changeRequestsFor(
      actor.userId,
      rows.map((row) => row.id),
    );
    const byOrganization = new Map(requests.map((entry) => [entry.organizationId, entry]));
    return rows.map((row) => {
      const request = byOrganization.get(row.id);
      return {
        ...row,
        changeRequest: request ? { comment: request.comment, at: request.at } : null,
      };
    });
  }

  return {
    async list(actor: Actor, query: StaffProviderListQuery): Promise<StaffProviderListResult> {
      const filters = toAdminProviderFilters({
        ...(query as AdminProviderListQuery),
        onboardedBy: actor.userId,
      } as AdminProviderListQuery);
      // Belt and braces: the owner is the caller, whatever the query said.
      filters.onboardedByUserId = actor.userId;

      const [result, facets] = await Promise.all([
        repositories.directory.search(
          filters,
          { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
          { field: query.sort, order: query.order },
        ),
        repositories.directory.facets(filters),
      ]);

      return {
        rows: await withChangeRequests(actor, result.rows),
        facets,
        meta: pageMeta({
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          sort: query.sort,
          order: query.order,
        }),
      };
    },

    async dashboard(actor: Actor): Promise<StaffDashboard> {
      const filters = baseFilters(actor);
      const currentMonth = startOfMonth(now());
      const previousMonth = addMonths(currentMonth, -1);

      const [facets, draftResult, returned, expiring, activity, monthlyCounts] = await Promise.all([
        repositories.directory.facets(filters),
        repositories.directory.search(
          { ...filters, statuses: ['DRAFT'] },
          { skip: 0, take: DRAFT_SAMPLE },
          { field: 'updated_at', order: 'desc' },
        ),
        repositories.staffWorkspace.changeRequests(actor.userId, 10),
        repositories.staffWorkspace.expiring(
          actor.userId,
          new Date(now().getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
          8,
        ),
        repositories.staffWorkspace.recentActivity(actor.userId, 8),
        repositories.staffWorkspace.monthlyCounts(actor.userId, previousMonth),
      ]);

      // Completeness is computed per draft for the percentage; the sample is
      // capped, and the count below still reflects every draft.
      const drafts: StaffDraftAttention[] = await Promise.all(
        draftResult.rows.map(async (row) => {
          const report = await onboarding.completeness(actor, row.id);
          const total = report.sections.length;
          const complete = report.sections.filter(
            (section) => section.status === 'complete',
          ).length;
          return {
            id: row.id,
            code: row.code,
            legalName: row.legalName,
            providerType: row.providerType,
            completenessPercent: total === 0 ? 0 : Math.round((complete / total) * 100),
            missingRequired: report.missingRequiredFields.length,
            updatedAt: row.updatedAt,
          };
        }),
      );
      drafts.sort(
        (left, right) =>
          left.completenessPercent - right.completenessPercent ||
          right.updatedAt.getTime() - left.updatedAt.getTime(),
      );

      const currentKey = monthKey(currentMonth);
      const previousKey = monthKey(previousMonth);
      const counts = new Map(monthlyCounts.map((entry) => [entry.month, entry.count]));

      return {
        total: facets.byStatus.reduce((sum, entry) => sum + entry.count, 0),
        byStatus: facets.byStatus,
        byType: facets.byType,
        drafts: drafts.slice(0, DASHBOARD_LIMIT),
        draftCount: draftResult.total,
        returned,
        expiring,
        activity,
        monthly: {
          month: currentKey,
          count: counts.get(currentKey) ?? 0,
          previousMonth: previousKey,
          previousCount: counts.get(previousKey) ?? 0,
        },
      };
    },
  };
}

export type StaffWorkspaceService = ReturnType<typeof createStaffWorkspaceService>;
