import {
  AppError,
  can,
  organizationStatusLabels,
  organizationStatuses,
  providerTypeLabels,
  providerTypes,
  type Actor,
  type AnalyticsFilters,
  type AnalyticsPinSummary,
  type OverviewQuery,
  type PinSummaryQuery,
  type StaffPerformanceQuery,
} from '@curenear/shared';
import type { ServiceDeps } from './service-deps';

/**
 * Admin analytics.
 *
 * Authorization is `provider.read.all`, the same permission as the provider
 * directory: administrators have it, staff do not. The PIN summary reads the
 * maintained `provider_pin_stats` table when the filters can be answered from
 * it, and falls back to a live aggregation (same definition) when a dimension
 * such as state, district, owner or date is requested.
 */
export function createAnalyticsService(deps: Pick<ServiceDeps, 'repositories'>) {
  const { repositories } = deps;

  function assertReader(actor: Actor): void {
    if (!can({ id: actor.userId, role: actor.role }, 'provider.read.all')) {
      throw new AppError('FORBIDDEN', 'Only administrators can view analytics');
    }
  }

  function filtersOf(query: AnalyticsFilters): AnalyticsFilters {
    return {
      providerType: query.providerType,
      status: query.status,
      state: query.state,
      district: query.district,
      onboardedBy: query.onboardedBy,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    };
  }

  /** The read model has no owner/date/geo columns, so those force the live path. */
  function readModelCanAnswer(filters: AnalyticsFilters): boolean {
    return (
      !filters.state &&
      !filters.district &&
      !filters.onboardedBy &&
      !filters.createdFrom &&
      !filters.createdTo
    );
  }

  return {
    async pinSummary(actor: Actor, query: PinSummaryQuery): Promise<AnalyticsPinSummary> {
      assertReader(actor);
      const filters = filtersOf(query);
      const q = query.q && query.q.length > 0 ? query.q : null;

      if (query.gapsOnly) {
        if (query.groupBy !== 'pin') {
          throw new AppError(
            'VALIDATION_ERROR',
            'Coverage gaps are listed by PIN; clear the grouping to use them',
          );
        }
        if (query.measure !== 'primary') {
          throw new AppError(
            'VALIDATION_ERROR',
            'Coverage gaps use the primary-location measure; switch back to providers in PIN',
          );
        }
        return repositories.analytics.coverageGaps(filters, q, query.page, query.pageSize);
      }

      return repositories.analytics.pinSummary(filters, {
        groupBy: query.groupBy,
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
        order: query.order,
        q,
        gapsOnly: false,
        useStats: query.groupBy === 'pin' && readModelCanAnswer(filters),
        measure: query.measure,
      });
    },

    /** CSV for the whole filtered view, not just the visible page. */
    async exportPinSummary(actor: Actor, query: PinSummaryQuery) {
      assertReader(actor);
      const filters = filtersOf(query);
      const summary = await repositories.analytics.pinSummary(filters, {
        groupBy: query.groupBy,
        page: 1,
        pageSize: 5000,
        sort: query.sort,
        order: query.order,
        q: query.q && query.q.length > 0 ? query.q : null,
        gapsOnly: false,
        useStats: query.groupBy === 'pin' && readModelCanAnswer(filters),
        measure: query.measure,
      });
      return {
        filename: `pin-analytics-${query.measure}-${query.groupBy}.csv`,
        csv: pinSummaryCsv(query.groupBy, summary),
      };
    },

    async overview(actor: Actor, query: OverviewQuery) {
      assertReader(actor);
      return repositories.analytics.overview(filtersOf(query), query.days);
    },

    async staffPerformance(actor: Actor, query: StaffPerformanceQuery) {
      assertReader(actor);
      return repositories.analytics.staffPerformance(filtersOf(query), query.page, 25);
    },
  };
}

/**
 * CSV for the current view. One column per provider type and per status so the
 * spreadsheet keeps the same detail as the table.
 */
export function pinSummaryCsv(
  groupedBy: 'pin' | 'district' | 'state',
  summary: AnalyticsPinSummary,
): string {
  const groupLabel = groupedBy === 'pin' ? 'pin_code' : groupedBy;
  const typeColumns = providerTypes.map((type) => providerTypeLabels[type]);
  const statusColumns = organizationStatuses.map((status) => organizationStatusLabels[status]);

  const header = [
    groupLabel,
    'measure',
    'state',
    'district',
    'total',
    'approved',
    ...typeColumns,
    ...statusColumns,
  ];

  const escape = (value: string | number | null): string => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = summary.rows.map((row) =>
    [
      row.pinCode ?? row.label,
      summary.measure,
      row.stateName,
      row.districtName,
      row.total,
      row.approved,
      ...providerTypes.map((type) => row.byType[type] ?? 0),
      ...organizationStatuses.map((status) => row.byStatus[status] ?? 0),
    ]
      .map(escape)
      .join(','),
  );

  return [header.map(escape).join(','), ...lines].join('\n');
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
