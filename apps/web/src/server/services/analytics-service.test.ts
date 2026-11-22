import { describe, expect, it, vi } from 'vitest';
import type { Actor, AnalyticsPinSummary, Repositories } from '@curenear/shared';
import { createAnalyticsService, pinSummaryCsv } from './analytics-service';

const admin: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'ADMIN' };
const staff: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'STAFF' };

const summary = (): AnalyticsPinSummary =>
  ({
    rows: [
      {
        label: '700091',
        pinCode: '700091',
        stateName: 'West Bengal',
        districtName: 'North 24 Parganas',
        total: 12,
        approved: 7,
        byType: { clinic: 3, doctor: 4, pharmacy: 5, diagnostic_centre: 0, care_provider: 0 },
        byStatus: { live: 7, submitted: 5 },
      },
      {
        label: '700,092',
        pinCode: '700,092',
        stateName: 'West Bengal',
        districtName: '"Special" district',
        total: 2,
        approved: 0,
        byType: {},
        byStatus: {},
      },
    ],
    totals: { groups: 2, providers: 14, approved: 7 },
    byType: [],
    byStatus: [],
    source: 'read_model',
    groupedBy: 'pin',
    measure: 'primary',
  }) as unknown as AnalyticsPinSummary;

function setup() {
  const repositories = {
    analytics: {
      pinSummary: vi.fn(async () => summary()),
      coverageGaps: vi.fn(async () => summary()),
      overview: vi.fn(async () => ({ totals: { providers: 1 } })),
      staffPerformance: vi.fn(async () => ({ rows: [], total: 0 })),
    },
  } as unknown as Repositories;

  return { service: createAnalyticsService({ repositories }), repositories };
}

const query = (patch: Record<string, unknown> = {}) =>
  ({
    page: 1,
    pageSize: 50,
    sort: 'total',
    order: 'desc',
    groupBy: 'pin',
    measure: 'primary',
    gapsOnly: false,
    ...patch,
  }) as never;

describe('analytics service', () => {
  it('refuses staff access to every admin analytics view', async () => {
    const { service } = setup();
    await expect(service.pinSummary(staff, query())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.overview(staff, { days: 30 } as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.staffPerformance(staff, {} as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('uses the maintained read model only when no extra dimension is filtered', async () => {
    const { service, repositories } = setup();
    await service.pinSummary(admin, query());
    expect(repositories.analytics.pinSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: undefined }),
      expect.objectContaining({ useStats: true, pageSize: 50 }),
    );

    await service.pinSummary(admin, query({ state: 'West Bengal' }));
    expect(repositories.analytics.pinSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'West Bengal' }),
      expect.objectContaining({ useStats: false }),
    );
  });

  it('routes coverage gaps and enforces their PIN/primary constraints', async () => {
    const { service, repositories } = setup();
    await service.pinSummary(admin, query({ gapsOnly: true }));
    expect(repositories.analytics.coverageGaps).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      1,
      50,
    );

    await expect(
      service.pinSummary(admin, query({ gapsOnly: true, groupBy: 'district' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.pinSummary(admin, query({ gapsOnly: true, measure: 'service' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('exports the whole filtered view, not just one page', async () => {
    const { service, repositories } = setup();
    const result = await service.exportPinSummary(
      admin,
      query({ measure: 'service', groupBy: 'state' }),
    );

    expect(repositories.analytics.pinSummary).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ page: 1, pageSize: 5000, measure: 'service', groupBy: 'state' }),
    );
    expect(result.filename).toBe('pin-analytics-service-state.csv');
    expect(result.csv.split('\n')).toHaveLength(3);
  });

  it('passes overview and staff-performance arguments through', async () => {
    const { service, repositories } = setup();
    await service.overview(admin, { days: 90, providerType: 'clinic' } as never);
    expect(repositories.analytics.overview).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: 'clinic' }),
      90,
    );

    await service.staffPerformance(admin, { page: 2, status: 'live' } as never);
    expect(repositories.analytics.staffPerformance).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'live' }),
      2,
      25,
    );
  });

  it('writes a spreadsheet-safe CSV with one column per type and status', () => {
    const csv = pinSummaryCsv('pin', summary());
    const [header, first, second] = csv.split('\n');

    expect(header).toContain('pin_code,measure,state,district,total,approved');
    expect(header).toContain('Clinic');
    expect(first?.startsWith('700091,primary,West Bengal,North 24 Parganas,12,7,')).toBe(true);
    expect(second).toContain('"700,092"');
    expect(second).toContain('"""Special"" district"');
    expect(
      pinSummaryCsv('district', summary()).split('\n')[0]?.startsWith('district,measure'),
    ).toBe(true);
  });
});
