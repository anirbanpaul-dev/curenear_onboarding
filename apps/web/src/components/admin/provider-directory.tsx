'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  adminProviderSortFields,
  organizationStatusLabels,
  organizationStatuses,
  providerTypeLabels,
  providerTypes,
  type OrganizationStatus,
  type ProviderType,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDate, cn } from '@/lib/utils';
import {
  Badge,
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
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AdminProviderMetaDto,
  AdminProviderRowDto,
  DistrictDto,
  PageMetaDto,
  ProviderDirectoryViewDto,
  StaffDto,
  StateDto,
} from '@/lib/types';

const columnHelper = createColumnHelper<AdminProviderRowDto>();
const PAGE_SIZES = [25, 50, 100];

const statusTone: Record<
  OrganizationStatus,
  { badge: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; dot: string }
> = {
  DRAFT: { badge: 'neutral', dot: 'bg-slate-400' },
  SUBMITTED: { badge: 'info', dot: 'bg-sky-500' },
  UNDER_REVIEW: { badge: 'info', dot: 'bg-indigo-500' },
  CHANGES_REQUESTED: { badge: 'warning', dot: 'bg-amber-500' },
  APPROVED: { badge: 'success', dot: 'bg-emerald-500' },
  SUSPENDED: { badge: 'danger', dot: 'bg-orange-500' },
  REJECTED: { badge: 'danger', dot: 'bg-red-500' },
  TERMINATED: { badge: 'danger', dot: 'bg-stone-500' },
};

function StatusPill({ status }: { status: OrganizationStatus }) {
  const tone = statusTone[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2 py-1 text-xs font-medium">
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      {organizationStatusLabels[status]}
    </span>
  );
}

interface FilterForm {
  q: string;
  providerTypes: ProviderType[];
  statuses: OrganizationStatus[];
  pin: string;
  state: string;
  district: string;
  onboardedBy: string;
  createdFrom: string;
  createdTo: string;
  submittedFrom: string;
  submittedTo: string;
  licenceExpiringDays: string;
  missingDocuments: '' | 'true' | 'false';
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
    state: params.get('state') ?? '',
    district: params.get('district') ?? '',
    onboardedBy: params.get('onboardedBy') ?? '',
    createdFrom: params.get('createdFrom') ?? '',
    createdTo: params.get('createdTo') ?? '',
    submittedFrom: params.get('submittedFrom') ?? '',
    submittedTo: params.get('submittedTo') ?? '',
    licenceExpiringDays: params.get('licenceExpiringDays') ?? '',
    missingDocuments: (params.get('missingDocuments') as FilterForm['missingDocuments']) ?? '',
  };
}

/** "700001, 7000" → ["700001", "7000"], rejecting anything malformed. */
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

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value);
  return Math.ceil((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function ExpiryCell({ value }: { value: string | null }) {
  const days = daysUntil(value);
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days < 0) return <Badge tone="danger">Expired</Badge>;
  if (days <= 30) return <Badge tone="danger">{days}d</Badge>;
  if (days <= 60) return <Badge tone="warning">{days}d</Badge>;
  return <span className="text-xs text-muted-foreground">{formatDate(value)}</span>;
}

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function toCsv(rows: AdminProviderRowDto[]): string {
  const header = [
    'provider_code',
    'legal_name',
    'trade_name',
    'provider_type',
    'status',
    'pin_code',
    'state',
    'district',
    'mobile',
    'registration_number',
    'onboarded_by',
    'submitted_at',
    'created_at',
  ];
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map((row) =>
    [
      row.code,
      row.legalName,
      row.tradeName,
      providerTypeLabels[row.providerType],
      organizationStatusLabels[row.status],
      row.primaryPinCode,
      row.stateName,
      row.districtName,
      row.mobile,
      row.registrationNumber,
      row.createdByName,
      row.submittedAt,
      row.createdAt,
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

function downloadCsv(rows: AdminProviderRowDto[]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `providers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h12M4 10h12M4 14h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="7" cy="6" r="1.6" fill="currentColor" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" />
      <circle cx="9" cy="14" r="1.6" fill="currentColor" />
    </svg>
  );
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

function ActiveChips({
  params,
  onRemove,
}: {
  params: URLSearchParams;
  onRemove: (key: string, value?: string) => void;
}) {
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
  if (params.get('state')) chips.push({ key: 'state', label: 'State' });
  if (params.get('district')) chips.push({ key: 'district', label: 'District' });
  if (params.get('onboardedBy')) chips.push({ key: 'onboardedBy', label: 'Onboarded by' });
  for (const key of ['createdFrom', 'createdTo', 'submittedFrom', 'submittedTo'] as const) {
    if (params.get(key)) chips.push({ key, label: `${key}: ${params.get(key)}` });
  }
  if (params.get('licenceExpiringDays')) {
    chips.push({
      key: 'licenceExpiringDays',
      label: `Licence ≤ ${params.get('licenceExpiringDays')}d`,
    });
  }
  if (params.get('missingDocuments') === 'true') {
    chips.push({ key: 'missingDocuments', label: 'Missing documents' });
  }
  if (params.get('missingDocuments') === 'false') {
    chips.push({ key: 'missingDocuments', label: 'Documents complete' });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      <span className="text-xs text-muted-foreground">Filters:</span>
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value ?? ''}`}
          type="button"
          onClick={() => onRemove(chip.key, chip.value)}
          className="inline-flex items-center gap-1 rounded-md border bg-secondary/60 px-2 py-1 text-xs transition-colors hover:bg-secondary"
        >
          {chip.label}
          <span aria-hidden="true" className="text-muted-foreground">
            ×
          </span>
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
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

function DirectoryInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);

  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const sort = params.get('sort') ?? 'created_at';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [form, setForm] = useState<FilterForm>(() => formFromParams(params));
  const [pinError, setPinError] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [viewName, setViewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A saved view or a shared link replaces the form's contents.
  useEffect(() => {
    setForm(formFromParams(new URLSearchParams(paramsKey)));
    setPinError(null);
  }, [paramsKey]);

  const states = useQuery({
    queryKey: ['master', 'states'],
    queryFn: () => api.get<StateDto[]>('/api/v1/master/states'),
    staleTime: 60 * 60 * 1000,
  });
  const districts = useQuery({
    queryKey: ['master', 'districts', form.state],
    queryFn: () =>
      api.get<DistrictDto[]>(
        `/api/v1/master/districts${form.state ? `?stateId=${form.state}` : ''}`,
      ),
    staleTime: 60 * 60 * 1000,
  });
  const staff = useQuery({
    queryKey: ['staff', 'directory-options'],
    queryFn: () => api.get<StaffDto[]>('/api/v1/admin/staff?page=1&pageSize=100'),
    staleTime: 5 * 60 * 1000,
  });

  const views = useQuery({
    queryKey: ['provider-views'],
    queryFn: () => api.get<ProviderDirectoryViewDto[]>('/api/v1/admin/provider-views'),
  });

  const query = useQuery({
    queryKey: ['admin-directory', paramsKey],
    queryFn: () =>
      api.get<AdminProviderRowDto[]>(
        `/api/v1/admin/providers?${paramsKey || 'page=1&pageSize=25'}`,
      ),
    placeholderData: keepPreviousData,
  });

  const meta = query.data?.meta as AdminProviderMetaDto | undefined;
  const facets = meta?.facets;
  const rows = query.data?.data ?? [];

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

  const advancedCount = useMemo(() => {
    const advancedKeys = [
      'state',
      'district',
      'onboardedBy',
      'createdFrom',
      'createdTo',
      'submittedFrom',
      'submittedTo',
      'licenceExpiringDays',
      'missingDocuments',
    ];
    return advancedKeys.filter((key) => params.get(key)).length;
  }, [params]);

  function navigate(next: URLSearchParams): void {
    const queryString = next.toString();
    router.replace(queryString ? `/admin/providers?${queryString}` : '/admin/providers');
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
    if (merged.state) next.set('state', merged.state);
    if (merged.district) next.set('district', merged.district);
    if (merged.onboardedBy) next.set('onboardedBy', merged.onboardedBy);
    if (merged.createdFrom) next.set('createdFrom', merged.createdFrom);
    if (merged.createdTo) next.set('createdTo', merged.createdTo);
    if (merged.submittedFrom) next.set('submittedFrom', merged.submittedFrom);
    if (merged.submittedTo) next.set('submittedTo', merged.submittedTo);
    if (merged.licenceExpiringDays) {
      next.set('licenceExpiringDays', merged.licenceExpiringDays);
    }
    if (merged.missingDocuments) next.set('missingDocuments', merged.missingDocuments);
    next.set('sort', sort);
    next.set('order', order);
    next.set('pageSize', String(pageSize));
    if (!resetPage && page > 1) next.set('page', String(page));
    navigate(next);
  }

  function removeFilter(key: string, value?: string): void {
    const next = new URLSearchParams(paramsKey);
    if (key === 'q' || key === 'state' || key === 'district' || key === 'onboardedBy') {
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

  function toggleSort(field: string): void {
    if (!(adminProviderSortFields as readonly string[]).includes(field)) return;
    const next = new URLSearchParams(paramsKey);
    next.set('sort', field);
    next.set('order', sort === field && order === 'asc' ? 'desc' : 'asc');
    next.delete('page');
    navigate(next);
  }

  async function saveView(): Promise<void> {
    const name = viewName.trim();
    if (!name) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.post('/api/v1/admin/provider-views', { name, query: paramsKey });
      setViewName('');
      setNotice(`Saved “${name}”.`);
      await queryClient.invalidateQueries({ queryKey: ['provider-views'] });
    } catch (error) {
      setNotice(error instanceof ApiClientError ? error.message : 'Could not save the view.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteView(id: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/api/v1/admin/provider-views/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['provider-views'] });
    } catch (error) {
      setNotice(error instanceof ApiClientError ? error.message : 'Could not delete the view.');
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select every row on this page"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.code}`}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      }),
      columnHelper.accessor('legalName', {
        id: 'legal_name',
        header: 'Provider',
        cell: (info) => (
          <div className="min-w-56 max-w-80">
            <p className="truncate font-medium">{info.getValue() ?? 'Untitled draft'}</p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{info.row.original.code}</span>
              {info.row.original.tradeName ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{info.row.original.tradeName}</span>
                </>
              ) : null}
            </p>
          </div>
        ),
      }),
      columnHelper.accessor('providerType', {
        id: 'provider_type',
        header: 'Type',
        cell: (info) => (
          <span className="text-sm text-muted-foreground">
            {providerTypeLabels[info.getValue()]}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        id: 'status',
        header: 'Status',
        cell: (info) => <StatusPill status={info.getValue()} />,
      }),
      columnHelper.accessor('primaryPinCode', {
        id: 'primary_pin_code',
        header: 'PIN',
        cell: (info) => <span className="font-mono text-xs">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.display({
        id: 'location',
        header: 'Location',
        cell: (info) => (
          <div className="min-w-32 text-xs">
            <p>{info.row.original.stateName ?? '—'}</p>
            <p className="text-muted-foreground">{info.row.original.districtName ?? ''}</p>
          </div>
        ),
      }),
      columnHelper.display({
        id: 'staff',
        header: 'Onboarded by',
        cell: (info) =>
          info.row.original.createdByName ? (
            <Link
              href={`/admin/staff/${info.row.original.createdByUserId}`}
              className="group inline-flex items-center gap-2 text-sm"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
                {initials(info.row.original.createdByName)}
              </span>
              <span className="max-w-32 truncate group-hover:underline">
                {info.row.original.createdByName}
              </span>
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      columnHelper.display({
        id: 'documents',
        header: 'Docs',
        cell: (info) =>
          info.row.original.documentCount === 0 ? (
            <Badge tone="warning">None</Badge>
          ) : (
            <span className="text-sm tabular-nums">{info.row.original.documentCount}</span>
          ),
      }),
      columnHelper.display({
        id: 'licence',
        header: 'Licence',
        cell: (info) => <ExpiryCell value={info.row.original.earliestLicenceExpiry} />,
      }),
      columnHelper.accessor('submittedAt', {
        id: 'submitted_at',
        header: 'Submitted',
        cell: (info) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(info.getValue() as string | null)}
          </span>
        ),
      }),
      columnHelper.accessor('createdAt', {
        id: 'created_at',
        header: 'Created',
        cell: (info) => (
          <span className="text-xs text-muted-foreground">{formatDate(info.getValue())}</span>
        ),
      }),
      columnHelper.display({
        id: 'open',
        header: '',
        cell: () => (
          <span aria-hidden="true" className="text-muted-foreground">
            ›
          </span>
        ),
        enableSorting: false,
        enableHiding: false,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const pageMeta = meta as PageMetaDto | undefined;

  return (
    <div className="space-y-3">
      {notice ? (
        <p role="status" className="rounded-md border bg-secondary px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      <Card className="shadow-sm">
        <CardContent className="space-y-3 p-3">
          {/* One-line filter toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 md:max-w-[15rem]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <SearchIcon />
              </span>
              <Input
                id="directory-search"
                className="h-9 pl-9"
                placeholder="Search name, mobile, registration or code"
                value={form.q}
                aria-label="Search providers"
                onChange={(event) => setForm({ ...form, q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyForm({ q: form.q });
                }}
              />
            </div>

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
              <SlidersIcon />
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

            <div className="ml-auto flex items-center gap-1.5">
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border bg-card px-2.5 text-xs hover:bg-accent/60">
                  Views
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 text-muted-foreground">
                    <path
                      d="m4 6 4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border bg-card p-3 shadow-lg">
                  <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Saved views
                  </p>
                  {(views.data?.data ?? []).length === 0 ? (
                    <p className="px-1 py-1 text-xs text-muted-foreground">No saved views yet.</p>
                  ) : (
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                      {(views.data?.data ?? []).map((view) => (
                        <li
                          key={view.id}
                          className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-accent/60"
                        >
                          <button
                            type="button"
                            className="truncate text-left text-sm hover:underline"
                            onClick={() =>
                              router.replace(
                                view.query ? `/admin/providers?${view.query}` : '/admin/providers',
                              )
                            }
                          >
                            {view.name}
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={busy}
                            aria-label={`Delete ${view.name}`}
                            onClick={() => void deleteView(view.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 border-t pt-2">
                    <Label htmlFor="view-name" className="text-xs">
                      Save current filters
                    </Label>
                    <Input
                      id="view-name"
                      className="mt-1 h-8"
                      placeholder="View name"
                      value={viewName}
                      onChange={(event) => setViewName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveView();
                      }}
                    />
                    <Button
                      size="sm"
                      className="mt-2 w-full"
                      disabled={busy || !viewName.trim()}
                      onClick={() => void saveView()}
                    >
                      Save view
                    </Button>
                  </div>
                </div>
              </details>

              <details className="relative">
                <summary
                  aria-label="Choose columns"
                  title="Choose columns"
                  className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border bg-card hover:bg-accent/60"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                    <path
                      d="M4 4h12v12H4zM4 8h12M4 12h12M9 4v12"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                  </svg>
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-52 rounded-lg border bg-card p-2 shadow-lg">
                  {table
                    .getAllLeafColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <label
                        key={column.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/60"
                      >
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                        />
                        {typeof column.columnDef.header === 'string'
                          ? column.columnDef.header
                          : column.id.replace(/_/g, ' ')}
                      </label>
                    ))}
                </div>
              </details>

              <details className="relative">
                <summary
                  aria-label="Export"
                  title="Export"
                  className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border bg-card hover:bg-accent/60"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                    <path
                      d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border bg-card p-2 shadow-lg">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-50"
                    disabled={selectedRows.length === 0}
                    onClick={() => downloadCsv(selectedRows)}
                  >
                    Selected ({selectedRows.length})
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-50"
                    disabled={rows.length === 0}
                    onClick={() => downloadCsv(rows)}
                  >
                    This page ({rows.length})
                  </button>
                </div>
              </details>
            </div>
          </div>

          <ActiveChips params={params} onRemove={removeFilter} />
        </CardContent>
      </Card>

      {query.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {query.error instanceof ApiClientError
            ? query.error.message
            : 'Could not load the provider directory.'}
        </p>
      ) : null}

      <Card className="overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-secondary/70 backdrop-blur">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const field = header.column.id;
                  const sortable = (adminProviderSortFields as readonly string[]).includes(field);
                  return (
                    <TableHead
                      key={header.id}
                      className="h-10 whitespace-nowrap px-3 text-[11px] font-semibold"
                      aria-sort={
                        sort === field ? (order === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      {sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => toggleSort(field)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'text-[9px]',
                              sort === field ? 'text-foreground' : 'text-muted-foreground/40',
                            )}
                          >
                            {sort === field ? (order === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {query.isPending
              ? Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                    <TableCell colSpan={columns.length} className="px-3 py-3">
                      <div className="h-4 animate-pulse rounded bg-secondary" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!query.isPending && rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-16 text-center">
                  <p className="text-sm font-medium">No providers match these filters</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Clear a filter or widen the PIN prefix to see more.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => router.replace('/admin/providers')}
                  >
                    Reset filters
                  </Button>
                </TableCell>
              </TableRow>
            ) : null}
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="group cursor-pointer odd:bg-card even:bg-secondary/10"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('a, button, input, label, summary')) return;
                  router.push(`/admin/providers/${row.original.id}`);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'px-3 py-2.5',
                      cell.column.id === 'open' && 'w-6 pr-4 text-right',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary/20 px-3 py-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {pageMeta
                ? `${pageMeta.total.toLocaleString('en-IN')} provider(s)`
                : query.isPending
                  ? 'Loading…'
                  : '—'}
            </span>
            {selectedRows.length > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-primary">
                {selectedRows.length} selected
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setRowSelection({})}
                >
                  Clear
                </button>
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Select
              aria-label="Rows per page"
              className="h-8 w-24 text-xs"
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
            </Select>
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
            <p className="text-xs text-muted-foreground">
              Narrow the directory by territory, staff or dates.
            </p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="drawer-state">State</Label>
              <Select
                id="drawer-state"
                className="mt-1 h-9"
                value={form.state}
                onChange={(event) => setForm({ ...form, state: event.target.value, district: '' })}
              >
                <option value="">Any state</option>
                {(states.data?.data ?? []).map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="drawer-district">District</Label>
              <Select
                id="drawer-district"
                className="mt-1 h-9"
                value={form.district}
                disabled={!form.state}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              >
                <option value="">Any district</option>
                {(districts.data?.data ?? []).map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="drawer-staff">Onboarded by</Label>
            <Select
              id="drawer-staff"
              className="mt-1 h-9"
              value={form.onboardedBy}
              onChange={(event) => setForm({ ...form, onboardedBy: event.target.value })}
            >
              <option value="">Anyone</option>
              {(staff.data?.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Created
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="drawer-created-from">From</Label>
                <Input
                  id="drawer-created-from"
                  className="mt-1 h-9"
                  type="date"
                  value={form.createdFrom}
                  onChange={(event) => setForm({ ...form, createdFrom: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="drawer-created-to">To</Label>
                <Input
                  id="drawer-created-to"
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
                <Label htmlFor="drawer-submitted-from">From</Label>
                <Input
                  id="drawer-submitted-from"
                  className="mt-1 h-9"
                  type="date"
                  value={form.submittedFrom}
                  onChange={(event) => setForm({ ...form, submittedFrom: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="drawer-submitted-to">To</Label>
                <Input
                  id="drawer-submitted-to"
                  className="mt-1 h-9"
                  type="date"
                  value={form.submittedTo}
                  onChange={(event) => setForm({ ...form, submittedTo: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="drawer-expiry">Licence expiring (days)</Label>
              <Input
                id="drawer-expiry"
                className="mt-1 h-9"
                type="number"
                min={0}
                max={365}
                placeholder="e.g. 30"
                value={form.licenceExpiringDays}
                onChange={(event) => setForm({ ...form, licenceExpiringDays: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="drawer-documents">Documents</Label>
              <Select
                id="drawer-documents"
                className="mt-1 h-9"
                value={form.missingDocuments}
                onChange={(event) =>
                  setForm({
                    ...form,
                    missingDocuments: event.target.value as FilterForm['missingDocuments'],
                  })
                }
              >
                <option value="">Any</option>
                <option value="true">Missing documents</option>
                <option value="false">Complete</option>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const cleared: Partial<FilterForm> = {
                state: '',
                district: '',
                onboardedBy: '',
                createdFrom: '',
                createdTo: '',
                submittedFrom: '',
                submittedTo: '',
                licenceExpiringDays: '',
                missingDocuments: '',
              };
              setForm({ ...form, ...cleared });
              applyForm(cleared);
            }}
          >
            Clear advanced
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                applyForm();
                setDrawerOpen(false);
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

export function ProviderDirectory() {
  return <DirectoryInner />;
}
