'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  exportStatusLabels,
  exportTypeLabels,
  type ExportJobDto,
  type ExportStatus,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
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

const PAGE_SIZE = 20;

const statusTone: Record<ExportStatus, string> = {
  QUEUED: 'bg-slate-100 text-slate-700',
  RUNNING: 'bg-sky-100 text-sky-800',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-amber-100 text-amber-900',
};

function dateTime(value: string): string {
  return `${formatDate(value)} ${new Date(value).toISOString().slice(11, 16)}`;
}

export function ExportHistory() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['exports', page],
    queryFn: () =>
      api.get<{ rows: ExportJobDto[]; meta: { total: number; totalPages: number } }>(
        `/api/v1/exports?page=${page}&pageSize=${PAGE_SIZE}`,
      ),
    // Poll only while something is still being generated.
    refetchInterval: (result) => {
      const rows = result.state.data?.data.rows ?? [];
      return rows.some((row) => row.status === 'QUEUED' || row.status === 'RUNNING') ? 4000 : false;
    },
  });

  const result = query.data?.data;
  const rows = result?.rows ?? [];

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardContent className="p-0">
        {query.isError ? (
          <p
            role="alert"
            className="border-b border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {query.error instanceof ApiClientError
              ? query.error.message
              : 'Could not load your exports.'}
          </p>
        ) : null}

        <Table>
          <TableHeader className="bg-secondary/70">
            <TableRow className="hover:bg-transparent">
              <TableHead>Export</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Available until</TableHead>
              <TableHead className="text-right">File</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending
              ? Array.from({ length: 4 }).map((_, index) => (
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
                  <p className="text-sm font-medium">No exports yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use an Export CSV button on a listing page. Files appear here when they are
                    ready.
                  </p>
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((row) => (
              <TableRow key={row.id} className="odd:bg-card even:bg-secondary/10">
                <TableCell className="px-3 py-2.5">
                  <p className="font-medium">{exportTypeLabels[row.type]}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {row.id.slice(0, 8)}
                  </p>
                  {row.error ? (
                    <p className="mt-1 max-w-sm text-xs text-destructive">{row.error}</p>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                  {dateTime(row.createdAt)}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right font-mono text-xs">
                  {row.rowCount === null ? '—' : row.rowCount.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusTone[row.status]}`}
                  >
                    {exportStatusLabels[row.status]}
                  </span>
                </TableCell>
                <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                  {formatDate(row.expiresAt)}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right">
                  {row.downloadable ? (
                    <a
                      href={`/api/v1/exports/${row.id}/download`}
                      className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent/60"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {row.status === 'EXPIRED' ? 'Expired' : '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t bg-secondary/20 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {result ? `${result.meta.total.toLocaleString('en-IN')} export(s)` : '—'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {result?.meta.totalPages ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!result || page >= result.meta.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
