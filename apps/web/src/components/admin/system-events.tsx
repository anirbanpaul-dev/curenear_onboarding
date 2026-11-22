'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminEventsResult } from '@curenear/shared';
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
import { Input } from '@/components/ui/input';

type Status = 'all' | 'pending' | 'published' | 'dead';

const statuses: Array<{ value: Status; label: string }> = [
  { value: 'all', label: 'All events' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'dead', label: 'Dead-lettered' },
];

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function tone(row: AdminEventsResult['rows'][number]) {
  if (row.deadLetteredAt) return 'danger' as const;
  if (row.publishedAt) return 'success' as const;
  return 'warning' as const;
}

function label(row: AdminEventsResult['rows'][number]): string {
  if (row.deadLetteredAt) return 'Dead-lettered';
  if (row.publishedAt) return 'Published';
  return 'Pending';
}

/**
 * Outbox console: every event the worker has seen, with the dead-letter queue
 * first. Retrying clears the dead-letter marker so the publisher claims the row
 * again on its next tick.
 */
export function SystemEvents() {
  const [status, setStatus] = useState<Status>('all');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminEventsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: '25',
      });
      if (eventType.trim()) params.set('eventType', eventType.trim());
      const response = await fetch(`/api/v1/admin/system/events?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load events');
      setData(body.data as AdminEventsResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load events');
    } finally {
      setLoading(false);
    }
  }, [status, eventType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/system/events/${id}/retry`, { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not retry this event');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retry this event');
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="space-y-1">
            <label htmlFor="event-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select
              id="event-status"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as Status);
              }}
            >
              {statuses.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="event-type" className="text-xs text-muted-foreground">
              Event type
            </label>
            <Input
              id="event-type"
              className="w-64"
              placeholder="provider.approved"
              value={eventType}
              onChange={(event) => {
                setPage(1);
                setEventType(event.target.value);
              }}
            />
          </div>
          {data ? (
            <Badge tone={data.deadCount > 0 ? 'danger' : 'success'}>
              {data.deadCount} dead-lettered
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Card>
        <CardContent className="pt-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Aggregate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Occurred</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No events match this filter.
                  </TableCell>
                </TableRow>
              ) : null}
              {data?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.eventType}
                    <span className="ml-2 text-xs text-muted-foreground">v{row.eventVersion}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.aggregateType}
                    <span className="block">{row.aggregateId.slice(0, 8)}…</span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={tone(row)}>{label(row)}</Badge>
                  </TableCell>
                  <TableCell>{row.attempts}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTime(row.occurredAt)}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {row.lastError ?? '—'}
                  </TableCell>
                  <TableCell>
                    {row.deadLetteredAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === row.id}
                        onClick={() => void retry(row.id)}
                      >
                        {busy === row.id ? 'Retrying…' : 'Retry'}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {data ? `${data.total} event(s)` : 'Loading…'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
