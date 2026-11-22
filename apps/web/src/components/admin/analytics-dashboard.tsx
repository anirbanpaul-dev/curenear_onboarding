'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  organizationStatusLabels,
  organizationStatuses,
  pinStatMeasureLabels,
  pinStatMeasures,
  providerTypeLabels,
  providerTypes,
  type AnalyticsGroupBy,
  type AnalyticsGroupRow,
  type AnalyticsOverview,
  type AnalyticsPinSummary,
  type OrganizationStatus,
  type PinStatMeasure,
  type ProviderType,
  type StaffPerformanceResult,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { ExportButton } from '@/components/exports/export-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { DistrictDto, StateDto } from '@/lib/types';

const TYPE_COLORS: Record<ProviderType, string> = {
  doctor: 'bg-sky-500',
  clinic: 'bg-emerald-500',
  pharmacy: 'bg-amber-500',
  diagnostic_centre: 'bg-violet-500',
  care_provider: 'bg-rose-500',
};

const TYPE_SHORT: Record<ProviderType, string> = {
  doctor: 'Doctors',
  clinic: 'Clinics',
  pharmacy: 'Pharmacies',
  diagnostic_centre: 'Diagnostics',
  care_provider: 'Care',
};

const PAGE_SIZE = 25;

interface Filters {
  providerType: ProviderType[];
  status: OrganizationStatus[];
  state: string;
  district: string;
  createdFrom: string;
  createdTo: string;
}

const emptyFilters: Filters = {
  providerType: [],
  status: [],
  state: '',
  district: '',
  createdFrom: '',
  createdTo: '',
};

type QueryValue = string | number | boolean | undefined;

function queryString(filters: Filters, extra: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  if (filters.providerType.length > 0) params.set('providerType', filters.providerType.join(','));
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.state) params.set('state', filters.state);
  if (filters.district) params.set('district', filters.district);
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) params.set('createdTo', filters.createdTo);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function number(value: number): string {
  return value.toLocaleString('en-IN');
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-card text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

export function AnalyticsDashboard() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>('pin');
  const [measure, setMeasure] = useState<PinStatMeasure>('primary');
  const [sort, setSort] = useState<'pin_code' | 'total' | 'approved'>('total');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [gapsPage, setGapsPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const states = useQuery({
    queryKey: ['master', 'states'],
    queryFn: () => api.get<StateDto[]>('/api/v1/master/states'),
  });
  const districts = useQuery({
    queryKey: ['master', 'districts', filters.state],
    queryFn: () =>
      api.get<DistrictDto[]>(
        `/api/v1/master/districts${filters.state ? `?stateId=${filters.state}` : ''}`,
      ),
  });

  const overview = useQuery({
    queryKey: ['analytics', 'overview', filters],
    queryFn: () =>
      api
        .get<AnalyticsOverview>(
          `/api/v1/admin/analytics/overview?${queryString(filters, { days: 30 })}`,
        )
        .then((result) => result.data),
  });

  const summary = useQuery({
    queryKey: [
      'analytics',
      'pin-summary',
      filters,
      groupBy,
      measure,
      sort,
      order,
      page,
      debouncedSearch,
    ],
    queryFn: () =>
      api
        .get<AnalyticsPinSummary>(
          `/api/v1/admin/analytics/pin-summary?${queryString(filters, {
            groupBy,
            measure,
            page,
            pageSize: PAGE_SIZE,
            sort,
            order,
            q: debouncedSearch,
          })}`,
        )
        .then((result) => result.data),
  });

  const topPins = useQuery({
    queryKey: ['analytics', 'top-pins', filters, measure, debouncedSearch],
    queryFn: () =>
      api
        .get<AnalyticsPinSummary>(
          `/api/v1/admin/analytics/pin-summary?${queryString(filters, {
            groupBy: 'pin',
            measure,
            pageSize: 8,
            sort: 'total',
            order: 'desc',
            q: debouncedSearch,
          })}`,
        )
        .then((result) => result.data),
  });

  const gaps = useQuery({
    queryKey: ['analytics', 'gaps', filters, gapsPage],
    queryFn: () =>
      api
        .get<AnalyticsPinSummary>(
          `/api/v1/admin/analytics/pin-summary?${queryString(filters, {
            gapsOnly: true,
            page: gapsPage,
            pageSize: 10,
          })}`,
        )
        .then((result) => result.data),
  });

  const staff = useQuery({
    queryKey: ['analytics', 'staff', filters],
    queryFn: () =>
      api
        .get<StaffPerformanceResult>(
          `/api/v1/admin/analytics/staff-performance?${queryString(filters, { page: 1 })}`,
        )
        .then((result) => result.data),
  });

  const rows = summary.data?.rows ?? [];
  const totalGroups = summary.data?.totals.groups ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));

  const currentViewName = useMemo(() => {
    const bits = [
      filters.state ? `state ${filters.state}` : null,
      filters.district ? `district ${filters.district}` : null,
      filters.providerType.length > 0
        ? filters.providerType.map((type) => TYPE_SHORT[type]).join(', ')
        : null,
      filters.status.length > 0 ? `${filters.status.length} statuses` : null,
      debouncedSearch ? `search ${debouncedSearch}` : null,
    ].filter(Boolean);
    return bits.length > 0 ? bits.join(' · ') : 'All providers';
  }, [filters, debouncedSearch]);

  const toggleType = (type: ProviderType) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      providerType: current.providerType.includes(type)
        ? current.providerType.filter((entry) => entry !== type)
        : [...current.providerType, type],
    }));
  };

  const toggleStatus = (status: OrganizationStatus) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      status: current.status.includes(status)
        ? current.status.filter((entry) => entry !== status)
        : [...current.status, status],
    }));
  };

  const sortBy = (field: 'pin_code' | 'total' | 'approved') => {
    setPage(1);
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setOrder(field === 'pin_code' ? 'asc' : 'desc');
    }
  };

  const drill = (row: AnalyticsGroupRow) => {
    setPage(1);
    if (groupBy === 'state') {
      setFilters((current) => ({ ...current, state: row.key, district: '' }));
      setGroupBy('district');
    } else if (groupBy === 'district') {
      setFilters((current) => ({ ...current, district: row.key }));
      setGroupBy('pin');
    }
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setSearch('');
    setDebouncedSearch('');
    setGroupBy('pin');
    setMeasure('primary');
    setPage(1);
    setGapsPage(1);
  };

  const error =
    overview.error ?? summary.error ?? topPins.error ?? gaps.error ?? staff.error ?? null;

  const maxTop = Math.max(1, ...(topPins.data?.rows ?? []).map((row) => row.total));
  const maxFunnel = Math.max(1, ...(overview.data ? Object.values(overview.data.funnel) : [1]));
  const maxPerDay = Math.max(1, ...(overview.data?.perDay ?? []).map((day) => day.count));

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">
            {error instanceof ApiClientError ? error.message : 'Could not load analytics'}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Filters</CardTitle>
          <CardDescription>{currentViewName}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {providerTypes.map((type) => (
              <Toggle
                key={type}
                active={filters.providerType.includes(type)}
                onClick={() => toggleType(type)}
              >
                {providerTypeLabels[type]}
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {organizationStatuses.map((status) => (
              <Toggle
                key={status}
                active={filters.status.includes(status)}
                onClick={() => toggleStatus(status)}
              >
                {organizationStatusLabels[status]}
              </Toggle>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label htmlFor="analytics-state">State</Label>
              <Select
                id="analytics-state"
                value={filters.state}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({
                    ...current,
                    state: event.target.value,
                    district: '',
                  }));
                }}
              >
                <option value="">All states</option>
                {(states.data?.data ?? []).map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="analytics-district">District</Label>
              <Select
                id="analytics-district"
                value={filters.district}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, district: event.target.value }));
                }}
              >
                <option value="">All districts</option>
                {(districts.data?.data ?? []).map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="analytics-from">Onboarded from</Label>
              <Input
                id="analytics-from"
                type="date"
                value={filters.createdFrom}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, createdFrom: event.target.value }));
                }}
              />
            </div>
            <div>
              <Label htmlFor="analytics-to">Onboarded to</Label>
              <Input
                id="analytics-to"
                type="date"
                value={filters.createdTo}
                onChange={(event) => {
                  setPage(1);
                  setFilters((current) => ({ ...current, createdTo: event.target.value }));
                }}
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={resetFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Providers" value={number(overview.data?.totals.providers ?? 0)} />
        <Kpi
          label="Approved"
          value={number(overview.data?.totals.approved ?? 0)}
          hint={`${
            overview.data && overview.data.totals.providers > 0
              ? Math.round((overview.data.totals.approved / overview.data.totals.providers) * 100)
              : 0
          }% approval rate`}
        />
        <Kpi
          label="In review"
          value={number(
            (overview.data?.totals.submitted ?? 0) + (overview.data?.totals.underReview ?? 0),
          )}
          hint={`${number(overview.data?.totals.changesRequested ?? 0)} waiting on provider`}
        />
        <Kpi
          label="Average review time"
          value={
            overview.data?.averageReviewDays === null || overview.data === undefined
              ? '—'
              : `${overview.data.averageReviewDays} d`
          }
          hint="Submission to approval"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>Draft → Submitted → Approved (ever reached)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['draft', 'submitted', 'approved'] as const).map((stage, index) => {
              const value = overview.data?.funnel[stage] ?? 0;
              const colors = ['bg-slate-400', 'bg-sky-500', 'bg-emerald-500'];
              return (
                <div key={stage}>
                  <div className="flex justify-between text-sm">
                    <span className="capitalize">{stage}</span>
                    <span className="font-medium">{number(value)}</span>
                  </div>
                  <div className="mt-1 h-3 rounded bg-secondary">
                    <div
                      className={cn('h-3 rounded', colors[index])}
                      style={{ width: `${Math.max(2, (value / maxFunnel) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Onboarding per day</CardTitle>
            <CardDescription>New providers created in the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-28 items-end gap-1">
              {(overview.data?.perDay ?? []).map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.count}`}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{ height: `${Math.max(2, (day.count / maxPerDay) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{overview.data?.perDay[0]?.date ?? ''}</span>
              <span>{overview.data?.perDay.at(-1)?.date ?? ''}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top PINs</CardTitle>
          <CardDescription>
            Top 8 PINs for “{pinStatMeasureLabels[measure]}”, split by provider type.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(topPins.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers match these filters.</p>
          ) : (
            (topPins.data?.rows ?? []).map((row) => (
              <div key={row.key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <Link
                    href={`/admin/providers?pin=${row.pinCode ?? ''}`}
                    className="font-mono font-medium text-primary hover:underline"
                  >
                    {row.label}
                  </Link>
                  <span className="text-muted-foreground">
                    {row.districtName ?? 'Unknown district'} · {number(row.total)}
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded bg-secondary">
                  {providerTypes.map((type) => {
                    const value = row.byType[type] ?? 0;
                    if (value === 0) return null;
                    return (
                      <div
                        key={type}
                        className={TYPE_COLORS[type]}
                        style={{ width: `${(value / maxTop) * 100}%` }}
                        title={`${providerTypeLabels[type]}: ${value}`}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <div className="flex flex-wrap gap-3 pt-2 text-xs text-muted-foreground">
            {providerTypes.map((type) => (
              <span key={type} className="flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-full', TYPE_COLORS[type])} />
                {TYPE_SHORT[type]}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>PIN coverage</CardTitle>
            <CardDescription>
              {pinStatMeasureLabels[measure]}.{' '}
              {groupBy === 'pin'
                ? 'Click a PIN to open the filtered directory.'
                : groupBy === 'district'
                  ? 'Click a district to see its PINs.'
                  : 'Click a state to drill into districts.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pinStatMeasures.map((option) => (
              <Toggle
                key={option}
                active={measure === option}
                onClick={() => {
                  setMeasure(option);
                  setPage(1);
                }}
              >
                {pinStatMeasureLabels[option]}
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['state', 'district', 'pin'] as const).map((level) => (
              <Toggle
                key={level}
                active={groupBy === level}
                onClick={() => {
                  setGroupBy(level);
                  setPage(1);
                }}
              >
                {level === 'pin' ? 'PINs' : level === 'district' ? 'Districts' : 'States'}
              </Toggle>
            ))}
            <ExportButton
              type="pin_summary"
              label="Export"
              filters={{
                providerType: filters.providerType.length > 0 ? filters.providerType : undefined,
                status: filters.status.length > 0 ? filters.status : undefined,
                state: filters.state || undefined,
                district: filters.district || undefined,
                createdFrom: filters.createdFrom || undefined,
                createdTo: filters.createdTo || undefined,
                groupBy,
                measure,
                sort,
                order,
                q: debouncedSearch || undefined,
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder={groupBy === 'pin' ? 'Search PIN (e.g. 700)' : 'Search name'}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            {filters.state ? (
              <Badge tone="info">
                State: {(states.data?.data ?? []).find((s) => s.id === filters.state)?.name ?? '—'}
              </Badge>
            ) : null}
            {filters.district ? (
              <Badge tone="info">
                District:{' '}
                {(districts.data?.data ?? []).find((d) => d.id === filters.district)?.name ?? '—'}
              </Badge>
            ) : null}
            {filters.state || filters.district ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilters((current) => ({ ...current, state: '', district: '' }));
                  setGroupBy('state');
                  setPage(1);
                }}
              >
                Reset drill-down
              </Button>
            ) : null}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="font-medium" onClick={() => sortBy('pin_code')}>
                    {groupBy === 'pin' ? 'PIN' : groupBy === 'district' ? 'District' : 'State'}
                    {sort === 'pin_code' ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </TableHead>
                <TableHead>State</TableHead>
                <TableHead>District</TableHead>
                <TableHead className="text-right">
                  <button type="button" className="font-medium" onClick={() => sortBy('total')}>
                    Total{sort === 'total' ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" className="font-medium" onClick={() => sortBy('approved')}>
                    Approved{sort === 'approved' ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </TableHead>
                {providerTypes.map((type) => (
                  <TableHead key={type} className="text-right">
                    {TYPE_SHORT[type]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5 + providerTypes.length} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5 + providerTypes.length} className="text-muted-foreground">
                    No rows match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">
                      {groupBy === 'pin' && row.pinCode ? (
                        <Link
                          href={`/admin/providers?pin=${row.pinCode}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {row.pinCode}
                        </Link>
                      ) : groupBy === 'pin' ? (
                        row.label
                      ) : (
                        <button
                          type="button"
                          className="text-left text-primary hover:underline"
                          onClick={() => drill(row)}
                        >
                          {row.label}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>{row.stateName ?? '—'}</TableCell>
                    <TableCell>{row.districtName ?? '—'}</TableCell>
                    <TableCell className="text-right font-medium">{number(row.total)}</TableCell>
                    <TableCell className="text-right">{number(row.approved)}</TableCell>
                    {providerTypes.map((type) => (
                      <TableCell key={type} className="text-right">
                        {row.byType[type] ? number(row.byType[type] ?? 0) : '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {number(totalGroups)}{' '}
              {groupBy === 'pin' ? 'PINs' : groupBy === 'district' ? 'districts' : 'states'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span>
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coverage gaps</CardTitle>
          <CardDescription>
            Directory PINs with no approved provider (primary-location measure), in the selected
            state or district.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(gaps.data?.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No gaps: every matching PIN has an approved provider.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(gaps.data?.rows ?? []).map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                >
                  <div>
                    <Link
                      href={`/admin/providers?pin=${row.pinCode ?? ''}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {row.pinCode}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.districtName ?? 'Unknown district'}, {row.stateName ?? '—'}
                    </p>
                  </div>
                  <Badge tone={row.total === 0 ? 'danger' : 'warning'}>
                    {row.total === 0 ? 'No providers' : `${row.total} pending`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{number(gaps.data?.totals.groups ?? 0)} PINs without an approved provider</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={gapsPage <= 1}
                onClick={() => setGapsPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <Button size="sm" variant="outline" onClick={() => setGapsPage((value) => value + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Staff performance</CardTitle>
            <CardDescription>
              Providers created by each staff member, and how far they got.
            </CardDescription>
          </div>
          <ExportButton
            type="staff_performance"
            label="Export"
            filters={{
              providerType: filters.providerType.length > 0 ? filters.providerType : undefined,
              status: filters.status.length > 0 ? filters.status : undefined,
              state: filters.state || undefined,
              district: filters.district || undefined,
              createdFrom: filters.createdFrom || undefined,
              createdTo: filters.createdTo || undefined,
            }}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead className="text-right">Avg completion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staff.data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No staff onboarding matches these filters.
                  </TableCell>
                </TableRow>
              ) : (
                (staff.data?.rows ?? []).map((row) => (
                  <TableRow key={row.staffUserId}>
                    <TableCell>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </TableCell>
                    <TableCell className="text-right">{number(row.created)}</TableCell>
                    <TableCell className="text-right">{number(row.submitted)}</TableCell>
                    <TableCell className="text-right">{number(row.approved)}</TableCell>
                    <TableCell className="text-right">{number(row.rejected)}</TableCell>
                    <TableCell className="text-right">
                      {row.averageCompletionDays === null ? '—' : `${row.averageCompletionDays} d`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
