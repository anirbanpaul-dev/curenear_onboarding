'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { providerTypeLabels, providerTypes, type ReviewQueueResult } from '@curenear/shared';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type StaffOption = { id: string; name: string; email: string };

const slaTone = { ok: 'neutral', warning: 'warning', breached: 'danger' } as const;
const slaLabel = { ok: 'On time', warning: 'Ageing', breached: 'Overdue' } as const;

function queryString(filters: {
  providerType: string;
  pin: string;
  staff: string;
  assignedToMe: boolean;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (filters.providerType) params.set('providerType', filters.providerType);
  if (filters.pin) params.set('pin', filters.pin);
  if (filters.staff) params.set('staff', filters.staff);
  if (filters.assignedToMe) params.set('assignedToMe', 'true');
  params.set('page', String(filters.page));
  params.set('pageSize', '25');
  return params.toString();
}

/**
 * Review queue: SUBMITTED (and already opened UNDER_REVIEW) providers, oldest
 * first, with SLA ageing and assignment.
 */
export function ReviewQueue() {
  const [filters, setFilters] = useState({
    providerType: '',
    pin: '',
    staff: '',
    assignedToMe: false,
    page: 1,
  });
  const [data, setData] = useState<ReviewQueueResult | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warnHours, setWarnHours] = useState('48');
  const [breachHours, setBreachHours] = useState('72');
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/review?${queryString(filters)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load the queue');
      setData(body.data as ReviewQueueResult);
      setWarnHours(String(body.data.settings.warnHours));
      setBreachHours(String(body.data.settings.breachHours));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the queue');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch('/api/v1/admin/staff?pageSize=100')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.data) setStaff(body.data as StaffOption[]);
      })
      .catch(() => undefined);
  }, []);

  async function assign(id: string) {
    const response = await fetch(`/api/v1/admin/review/${id}/assign`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not assign this provider');
      return;
    }
    await load();
  }

  async function saveSettings() {
    setSettingsMessage(null);
    const response = await fetch('/api/v1/admin/review/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        warn_hours: Number(warnHours),
        breach_hours: Number(breachHours),
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setSettingsMessage(body?.error?.message ?? 'Could not save the thresholds');
      return;
    }
    setSettingsMessage('Thresholds saved');
    await load();
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Filters</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen((open) => !open)}>
              SLA thresholds
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Provider type</span>
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                value={filters.providerType}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    providerType: event.target.value,
                    page: 1,
                  }))
                }
              >
                <option value="">All types</option>
                {providerTypes.map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">PIN</span>
              <Input
                value={filters.pin}
                inputMode="numeric"
                placeholder="e.g. 700"
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    pin: event.target.value.replace(/\D/g, '').slice(0, 6),
                    page: 1,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Onboarding staff</span>
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                value={filters.staff}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, staff: event.target.value, page: 1 }))
                }
              >
                <option value="">All staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1 text-sm">
              <input
                type="checkbox"
                checked={filters.assignedToMe}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    assignedToMe: event.target.checked,
                    page: 1,
                  }))
                }
              />
              Assigned to me
            </label>
          </div>

          {settingsOpen ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border bg-secondary/30 p-3 text-sm">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Warn after (hours)</span>
                <Input
                  value={warnHours}
                  onChange={(event) => setWarnHours(event.target.value)}
                  className="w-28"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Breach after (hours)</span>
                <Input
                  value={breachHours}
                  onChange={(event) => setBreachHours(event.target.value)}
                  className="w-28"
                />
              </label>
              <Button size="sm" onClick={() => void saveSettings()}>
                Save thresholds
              </Button>
              {settingsMessage ? (
                <span className="text-xs text-muted-foreground">{settingsMessage}</span>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Queue {data ? `(${data.meta.total})` : ''}</CardTitle>
            <span className="text-xs text-muted-foreground">Oldest submission first</span>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading && !data ? (
            <p className="py-6 text-sm text-muted-foreground">Loading queue…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Nothing is waiting for review.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Type / PIN</TableHead>
                  <TableHead>Ageing</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/admin/review/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.legalName ?? row.code}
                      </Link>
                      <p className="font-mono text-[11px] text-muted-foreground">{row.code}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{providerTypeLabels[row.providerType]}</p>
                      <p className="font-mono text-muted-foreground">{row.pinCode ?? 'No PIN'}</p>
                    </TableCell>
                    <TableCell>
                      <Badge tone={slaTone[row.sla]}>{slaLabel[row.sla]}</Badge>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {row.ageHours === null ? 'Not submitted' : `${row.ageHours} h`}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>
                        {row.checklist.verified + row.checklist.notApplicable}/
                        {row.checklist.required} settled
                      </p>
                      <p
                        className={
                          row.checklist.total === 0 || row.checklist.blocking > 0
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {row.checklist.total === 0
                          ? 'Checklist missing'
                          : row.checklist.blocking > 0
                            ? `${row.checklist.blocking} blocking`
                            : 'Approval ready'}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs">
                      {row.staff?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.assignedTo ? (
                        row.assignedTo.name
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => void assign(row.id)}>
                          Assign to me
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/review/${row.id}`}
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Review
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data && data.meta.totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {data.meta.page} of {data.meta.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.meta.page <= 1}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.meta.page >= data.meta.totalPages}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
