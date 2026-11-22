'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  organizationStatusLabels,
  organizationStatuses,
  providerTypeLabels,
  providerTypes,
  type OrganizationStatus,
  type ProviderType,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { cn, formatDate } from '@/lib/utils';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AdminProviderMetaDto, PageMetaDto, StaffProviderRowDto } from '@/lib/types';

const PAGE_SIZES = [25, 50, 100];

const statusDot: Record<OrganizationStatus, string> = {
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-sky-500',
  UNDER_REVIEW: 'bg-indigo-500',
  CHANGES_REQUESTED: 'bg-amber-500',
  APPROVED: 'bg-emerald-500',
  SUSPENDED: 'bg-orange-500',
  REJECTED: 'bg-red-500',
  TERMINATED: 'bg-stone-500',
};

interface FilterForm {
  q: string;
  providerTypes: ProviderType[];
  statuses: OrganizationStatus[];
  pin: string;
  createdFrom: string;
  createdTo: string;
  submittedFrom: string;
  submittedTo: string;
}

function splitList(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

function formFromParams(params: URLSearchParams): FilterForm {
  return {
    q: params.get('q') ?? '',
    providerTypes: splitList(params.get('providerType')) as ProviderType[],
    statuses: splitList(params.get('status')) as OrganizationStatus[],
    pin: splitList(params.get('pin')).join(', '),
    createdFrom: params.get('createdFrom') ?? '',
    createdTo: params.get('createdTo') ?? '',
    submittedFrom: params.get('submittedFrom') ?? '',
    submittedTo: params.get('submittedTo') ?? '',
  };
}

function parsePins(value: string): { pins: string[]; error: string | null } {
  const entries = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = entries.filter((entry) => !/^[1-9][0-9]{0,5}$/.test(entry));
  if (invalid.length > 0) {
    return {
      pins: [],
      error: `Not a PIN or prefix: ${invalid.join(', ')}. Use 1–6 digits, no leading zero.`,
    };
  }
  return { pins: entries, error: null };
}

function actionFor(status: OrganizationStatus): { label: string; tone: 'primary' | 'outline' } {
  if (status === 'DRAFT') return { label: 'Resume', tone: 'primary' };
  if (status === 'CHANGES_REQUESTED') return { label: 'Fix changes', tone: 'primary' };
  return { label: 'View', tone: 'outline' };
}

function MultiFilterMenu<T extends string>({
  label,
  options,
  selected,
  labels,
  counts,
  onChange,
}: {
  label: string;
  options: readonly T[];
  selected: T[];
  labels: Record<T, string>;
  counts?: Map<string, number>;
  onChange: (next: T[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm transition-colors hover:bg-accent/60',
          selected.length > 0 && 'border-primary/40 bg-primary/5',
        )}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {selected.length === 0
            ? 'All'
            : selected.length === 1
              ? labels[selected[0]!]
              : `${selected.length} selected`}
        </span>
        <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 text-muted-foreground">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-40 mt-1 w-60 rounded-lg border bg-card p-2 shadow-lg">
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {options.map((option) => (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/60"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, option]
                          : selected.filter((value) => value !== option),
                      )
                    }
                  />
                  <span className="flex-1">{labels[option]}</span>
                  {counts?.has(option) ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {counts.get(option)}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => onChange([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close filters"
        className="absolute inset-0 cursor-default bg-slate-950/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Advanced filters"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-card shadow-2xl"
      >
        {children}
      </aside>
    </div>
  );
}

export function StaffDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);

  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const sort = params.get('sort') ?? 'updated_at';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [form, setForm] = useState<FilterForm>(() => formFromParams(params));
  const [pinError, setPinError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setForm(formFromParams(new URLSearchParams(paramsKey)));
    setPinError(null);
  }, [paramsKey]);

  const query = useQuery({
    queryKey: ['staff-directory', paramsKey],
    queryFn: () =>
      api.get<StaffProviderRowDto[]>(
        `/api/v1/staff/providers?${paramsKey || 'page=1&pageSize=25'}`,
      ),
    placeholderData: keepPreviousData,
  });

  const meta = query.data?.meta as AdminProviderMetaDto | undefined;
  const facets = meta?.facets;
  const rows = query.data?.data ?? [];
  const pageMeta = meta as PageMetaDto | undefined;

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of facets?.byType ?? []) map.set(entry.providerType, entry.count);
    return map;
  }, [facets]);

  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of facets?.byStatus ?? []) map.set(entry.status, entry.count);
    return map;
  }, [facets]);

  const advancedCount = useMemo(
    () =>
      ['createdFrom', 'createdTo', 'submittedFrom', 'submittedTo'].filter((key) => params.get(key))
        .length,
    [params],
  );

  function navigate(next: URLSearchParams): void {
    const queryString = next.toString();
    router.replace(queryString ? `/staff/providers?${queryString}` : '/staff/providers');
  }

  function applyForm(overrides: Partial<FilterForm> = {}, resetPage = true): void {
    const merged = { ...form, ...overrides };
    const { pins, error } = parsePins(merged.pin);
    setPinError(error);
    if (error) return;

    const next = new URLSearchParams();
    if (merged.q.trim()) next.set('q', merged.q.trim());
    for (const type of merged.providerTypes) next.append('providerType', type);
    for (const status of merged.statuses) next.append('status', status);
    for (const pin of pins) next.append('pin', pin);
    if (merged.createdFrom) next.set('createdFrom', merged.createdFrom);
    if (merged.createdTo) next.set('createdTo', merged.createdTo);
    if (merged.submittedFrom) next.set('submittedFrom', merged.submittedFrom);
    if (merged.submittedTo) next.set('submittedTo', merged.submittedTo);
    next.set('sort', sort);
    next.set('order', order);
    next.set('pageSize', String(pageSize));
    if (!resetPage && page > 1) next.set('page', String(page));
    navigate(next);
  }

  function removeFilter(key: string, value?: string): void {
    const next = new URLSearchParams(paramsKey);
    if (key === 'q') {
      next.delete(key);
    } else if (value) {
      next.delete(key);
      for (const entry of params.getAll(key).filter((entry) => entry !== value)) {
        next.append(key, entry);
      }
    } else {
      next.delete(key);
    }
    next.delete('page');
    navigate(next);
  }

  const chips: Array<{ key: string; value?: string; label: string }> = [];
  if (params.get('q')) chips.push({ key: 'q', label: `“${params.get('q')}”` });
  for (const type of splitList(params.get('providerType'))) {
    chips.push({
      key: 'providerType',
      value: type,
      label: providerTypeLabels[type as ProviderType] ?? type,
    });
  }
  for (const status of splitList(params.get('status'))) {
    chips.push({
      key: 'status',
      value: status,
      label: organizationStatusLabels[status as OrganizationStatus] ?? status,
    });
  }
  for (const pin of splitList(params.get('pin'))) {
    chips.push({ key: 'pin', value: pin, label: `PIN ${pin}${pin.length < 6 ? '*' : ''}` });
  }
  for (const key of ['createdFrom', 'createdTo', 'submittedFrom', 'submittedTo'] as const) {
    if (params.get(key)) chips.push({ key, label: `${key}: ${params.get(key)}` });
  }

  return (
    <div className="space-y-3">
      <Card className="shadow-sm">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 min-w-48 flex-1 md:max-w-[15rem]"
              placeholder="Search name, mobile, registration or code"
              aria-label="Search my providers"
              value={form.q}
              onChange={(event) => setForm({ ...form, q: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyForm({ q: form.q });
              }}
            />

            <MultiFilterMenu
              label="Type"
              options={providerTypes}
              selected={form.providerTypes}
              labels={providerTypeLabels}
              counts={typeCounts}
              onChange={(providerTypes) => {
                setForm({ ...form, providerTypes });
                applyForm({ providerTypes });
              }}
            />

            <MultiFilterMenu
              label="Status"
              options={organizationStatuses}
              selected={form.statuses}
              labels={organizationStatusLabels}
              counts={statusCounts}
              onChange={(statuses) => {
                setForm({ ...form, statuses });
                applyForm({ statuses });
              }}
            />

            <div className="relative">
              <Input
                className="h-9 w-28 font-mono"
                placeholder="PIN or prefix"
                aria-label="PIN code filter"
                value={form.pin}
                aria-invalid={pinError ? true : undefined}
                onChange={(event) => {
                  setForm({ ...form, pin: event.target.value });
                  setPinError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyForm({ pin: form.pin });
                }}
              />
              {pinError ? (
                <p
                  role="alert"
                  className="absolute left-0 top-10 z-20 w-56 text-xs text-destructive"
                >
                  {pinError}
                </p>
              ) : null}
            </div>

            <Button variant="outline" size="sm" className="h-9" onClick={() => setDrawerOpen(true)}>
              Filters
              {advancedCount > 0 ? (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {advancedCount}
                </span>
              ) : null}
            </Button>

            <Button size="sm" className="h-9" onClick={() => applyForm()}>
              Apply
            </Button>
          </div>

          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              <span className="text-xs text-muted-foreground">Filters:</span>
              {chips.map((chip) => (
                <button
                  key={`${chip.key}:${chip.value ?? ''}`}
                  type="button"
                  onClick={() => removeFilter(chip.key, chip.value)}
                  className="inline-flex items-center gap-1 rounded-md border bg-secondary/60 px-2 py-1 text-xs transition-colors hover:bg-secondary"
                >
                  {chip.label}
                  <span aria-hidden="true" className="text-muted-foreground">
                    ×
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {query.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {query.error instanceof ApiClientError
            ? query.error.message
            : 'Could not load your providers.'}
        </p>
      ) : null}

      <Card className="overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-secondary/70">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 text-[11px] font-semibold">Provider</TableHead>
              <TableHead className="h-10 text-[11px] font-semibold">Type</TableHead>
              <TableHead className="h-10 text-[11px] font-semibold">Status</TableHead>
              <TableHead className="h-10 text-[11px] font-semibold">PIN</TableHead>
              <TableHead className="h-10 text-[11px] font-semibold">Updated</TableHead>
              <TableHead className="h-10 text-right text-[11px] font-semibold">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending
              ? Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                    <TableCell colSpan={6} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-secondary" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!query.isPending && rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-16 text-center">
                  <p className="text-sm font-medium">No providers match these filters</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only providers you onboarded appear here.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => router.replace('/staff/providers')}
                  >
                    Reset filters
                  </Button>
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => {
              const action = actionFor(row.status);
              return (
                <TableRow key={row.id} className="odd:bg-card even:bg-secondary/10">
                  <TableCell className="px-3 py-2.5">
                    <div className="min-w-56 max-w-80">
                      <Link
                        href={`/staff/providers/${row.id}/edit`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.legalName ?? 'Untitled draft'}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{row.code}</span>
                        {row.tradeName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{row.tradeName}</span>
                          </>
                        ) : null}
                      </p>
                      {row.changeRequest ? (
                        <p className="mt-1 rounded border-l-2 border-amber-500 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          {row.changeRequest.comment}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm text-muted-foreground">
                    {providerTypeLabels[row.providerType]}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2 py-1 text-xs font-medium">
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', statusDot[row.status])}
                        aria-hidden="true"
                      />
                      {organizationStatusLabels[row.status]}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-xs">
                    {row.primaryPinCode ?? '—'}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    {formatDate(row.updatedAt)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right">
                    <Link
                      href={`/staff/providers/${row.id}/edit`}
                      className={
                        action.tone === 'primary'
                          ? 'inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90'
                          : 'inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent/60'
                      }
                    >
                      {action.label}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary/20 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {pageMeta
              ? `${pageMeta.total.toLocaleString('en-IN')} provider(s)`
              : query.isPending
                ? 'Loading…'
                : '—'}
          </span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Rows per page"
              className="h-8 rounded-md border border-input bg-card px-2 text-xs"
              value={String(pageSize)}
              onChange={(event) => {
                const next = new URLSearchParams(paramsKey);
                next.set('pageSize', event.target.value);
                next.delete('page');
                navigate(next);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Page {pageMeta?.page ?? page} of {pageMeta?.totalPages ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(paramsKey);
                next.set('page', String(Math.max(1, page - 1)));
                navigate(next);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!pageMeta || page >= pageMeta.totalPages}
              onClick={() => {
                const next = new URLSearchParams(paramsKey);
                next.set('page', String(page + 1));
                navigate(next);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Filters</h2>
            <p className="text-xs text-muted-foreground">Narrow your own providers by date.</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Created
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="staff-created-from">From</Label>
                <Input
                  id="staff-created-from"
                  className="mt-1 h-9"
                  type="date"
                  value={form.createdFrom}
                  onChange={(event) => setForm({ ...form, createdFrom: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="staff-created-to">To</Label>
                <Input
                  id="staff-created-to"
                  className="mt-1 h-9"
                  type="date"
                  value={form.createdTo}
                  onChange={(event) => setForm({ ...form, createdTo: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Submitted
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="staff-submitted-from">From</Label>
                <Input
                  id="staff-submitted-from"
                  className="mt-1 h-9"
                  type="date"
                  value={form.submittedFrom}
                  onChange={(event) => setForm({ ...form, submittedFrom: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="staff-submitted-to">To</Label>
                <Input
                  id="staff-submitted-to"
                  className="mt-1 h-9"
                  type="date"
                  value={form.submittedTo}
                  onChange={(event) => setForm({ ...form, submittedTo: event.target.value })}
                />
              </div>
            </div>
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setForm({
                ...form,
                createdFrom: '',
                createdTo: '',
                submittedFrom: '',
                submittedTo: '',
              });
            }}
          >
            Clear dates
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDrawerOpen(false);
                applyForm();
              }}
            >
              Apply filters
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
