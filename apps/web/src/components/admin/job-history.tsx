'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JobRunsResult } from '@curenear/shared';
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

function summarise(summary: Record<string, unknown>): string {
  const entries = Object.entries(summary).filter(
    ([, value]) => value !== null && value !== undefined,
  );
  if (entries.length === 0) return '—';
  return entries
    .slice(0, 4)
    .map(([key, value]) => (typeof value === 'object' ? `${key}: …` : `${key}: ${String(value)}`))
    .join(', ');
}

/** Scheduled job history: what ran, whether it succeeded, and what it did. */
export function JobHistory() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JobRunsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/system/jobs?page=${page}&pageSize=25`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load job history');
      setData(body.data as JobRunsResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load job history');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Card>
        <CardContent className="pt-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No job runs recorded yet. The worker writes one row per scheduled run.
                  </TableCell>
                </TableRow>
              ) : null}
              {data?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.queue}</TableCell>
                  <TableCell>
                    <Badge tone={row.status === 'SUCCEEDED' ? 'success' : 'danger'}>
                      {row.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{row.durationMs} ms</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {summarise(row.summary)}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-red-700">
                    {row.error ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {data ? `${data.total} run(s)` : 'Loading…'}
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
