'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { staffStatusLabels, staffStatuses } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
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
import type { PageMetaDto, StaffCredentialsDto, StaffDto } from '@/lib/types';
import { StaffDrawer } from './staff-drawer';

const PAGE_SIZE = 20;

function StatusPill({ status }: { status: StaffDto['status'] }) {
  const tone = status === 'ACTIVE' ? 'success' : status === 'LOCKED' ? 'warning' : 'danger';
  return <Badge tone={tone}>{staffStatusLabels[status]}</Badge>;
}

interface ConfirmState {
  staff: StaffDto;
  action: 'deactivate' | 'reset';
}

export function StaffDirectory({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({ q: '', status: '' });
  const [applied, setApplied] = useState({ q: '', status: '' });
  const [drawer, setDrawer] = useState<{ open: boolean; staff: StaffDto | null }>({
    open: false,
    staff: null,
  });
  const [credentials, setCredentials] = useState<StaffCredentialsDto | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reason, setReason] = useState('Deactivated by administrator');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (applied.q) params.set('q', applied.q);
    if (applied.status) params.set('status', applied.status);
    return params.toString();
  }, [page, applied]);

  const query = useQuery({
    queryKey: ['staff', queryString],
    queryFn: () => api.get<StaffDto[]>(`/api/v1/admin/staff?${queryString}`),
    placeholderData: keepPreviousData,
  });

  const meta = query.data?.meta as PageMetaDto | undefined;
  const rows = query.data?.data ?? [];

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['staff'] });
  }

  function applyFilters(): void {
    setApplied({ q: draft.q.trim(), status: draft.status });
    setPage(1);
  }

  async function runConfirm(): Promise<void> {
    if (!confirm) return;
    setBusy(true);
    setNotice(null);
    try {
      if (confirm.action === 'deactivate') {
        await api.post<StaffDto>(`/api/v1/admin/staff/${confirm.staff.id}/deactivate`, {
          reason: reason.trim(),
        });
        setNotice({ tone: 'success', message: `${confirm.staff.name} can no longer sign in.` });
      } else {
        const result = await api.post<StaffCredentialsDto>(
          `/api/v1/admin/staff/${confirm.staff.id}/reset-password`,
        );
        setCredentials(result.data);
        setNotice({ tone: 'success', message: 'Temporary password generated and emailed.' });
      }
      setConfirm(null);
      refresh();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiClientError ? error.message : 'The action failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function reactivate(staff: StaffDto): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await api.post<StaffDto>(`/api/v1/admin/staff/${staff.id}/reactivate`);
      setNotice({ tone: 'success', message: `${staff.name} can sign in again.` });
      refresh();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiClientError ? error.message : 'Could not reactivate.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === 'success'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
              : 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'
          }
        >
          {notice.message}
        </p>
      ) : null}

      {credentials ? (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-medium">
            Temporary password for {credentials.staff.name} — shown once
          </p>
          <p className="mt-1 text-xs">
            It was also emailed to {credentials.staff.email}. They must change it at first sign-in.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code
              data-testid="temporary-password"
              className="rounded bg-card px-2 py-1 font-mono text-sm"
            >
              {credentials.temporaryPassword}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(credentials.temporaryPassword)}
            >
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCredentials(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="staff-search">Search</Label>
              <Input
                id="staff-search"
                placeholder="Name, email, code or mobile"
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyFilters();
                }}
              />
            </div>
            <div>
              <Label htmlFor="staff-status">Status</Label>
              <Select
                id="staff-status"
                value={draft.status}
                onChange={(event) => {
                  setDraft({ ...draft, status: event.target.value });
                  setApplied({ q: draft.q.trim(), status: event.target.value });
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {staffStatuses.map((status) => (
                  <option key={status} value={status}>
                    {staffStatusLabels[status]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={applyFilters}>Apply</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({ q: '', status: '' });
                  setApplied({ q: '', status: '' });
                  setPage(1);
                }}
              >
                Reset
              </Button>
              <Button
                className="ml-auto"
                onClick={() => setDrawer({ open: true, staff: null })}
                data-testid="add-staff"
              >
                Add staff
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Employee code</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Territory</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Loading staff…
                </TableCell>
              </TableRow>
            ) : null}
            {query.isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-destructive">
                  {query.error instanceof ApiClientError
                    ? query.error.message
                    : 'Could not load staff.'}
                </TableCell>
              </TableRow>
            ) : null}
            {!query.isPending && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No staff match these filters.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((staff) => (
              <TableRow key={staff.id}>
                <TableCell>
                  <Link
                    href={`/admin/staff/${staff.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {staff.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{staff.email}</span>
                </TableCell>
                <TableCell className="font-mono text-xs">{staff.employeeCode ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{staff.mobile ?? '—'}</TableCell>
                <TableCell>
                  {staff.pinCodes.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-xs">{staff.pinCodes.join(', ')}</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill status={staff.status} />
                </TableCell>
                <TableCell>{formatDate(staff.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDrawer({ open: true, staff })}
                    >
                      Edit
                    </Button>
                    {staff.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || staff.id === currentUserId}
                        onClick={() => {
                          setReason('Deactivated by administrator');
                          setConfirm({ staff, action: 'deactivate' });
                        }}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => reactivate(staff)}
                      >
                        Reactivate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirm({ staff, action: 'reset' })}
                    >
                      Reset password
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {meta ? `${meta.total} staff member(s)` : ''}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {meta ? `Page ${meta.page} of ${meta.totalPages}` : ''}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!meta || page >= meta.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <StaffDrawer
        open={drawer.open}
        staff={drawer.staff}
        onClose={() => setDrawer({ open: false, staff: null })}
        onSaved={(created) => {
          refresh();
          if (created) setCredentials(created);
          setNotice({
            tone: 'success',
            message: created ? 'Staff member created.' : 'Staff member updated.',
          });
        }}
      />

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 bg-foreground/30"
            onClick={() => setConfirm(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-confirm-title"
            className="relative w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
          >
            <h2 id="staff-confirm-title" className="text-base font-semibold">
              {confirm.action === 'deactivate'
                ? `Deactivate ${confirm.staff.name}?`
                : `Reset the password for ${confirm.staff.name}?`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {confirm.action === 'deactivate'
                ? 'They are signed out immediately and cannot sign in again until reactivated.'
                : 'A new temporary password replaces the current one, and every session is revoked.'}
            </p>

            {confirm.action === 'deactivate' ? (
              <div className="mt-4">
                <Label htmlFor="staff-reason" required>
                  Reason
                </Label>
                <Input
                  id="staff-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                {reason.trim().length < 5 ? (
                  <p className="field-error">Give a reason of at least 5 characters.</p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                data-testid="confirm-staff-action"
                disabled={busy || (confirm.action === 'deactivate' && reason.trim().length < 5)}
                onClick={() => void runConfirm()}
              >
                {busy ? 'Working…' : confirm.action === 'deactivate' ? 'Deactivate' : 'Reset'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
