'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ExportJobDto, ExportType } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

const PAGINATION_KEYS = new Set(['page', 'pageSize', 'sort', 'order']);

/** Repeats become arrays, which the export filter schemas accept. */
function filtersFromParams(params: URLSearchParams): Record<string, unknown> {
  const result: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    if (PAGINATION_KEYS.has(key) || value === '') return;
    const existing = result[key];
    result[key] =
      existing === undefined
        ? value
        : [...(Array.isArray(existing) ? existing : [existing]), value];
  });
  return result;
}

export function ExportButton({
  type,
  filters,
  label = 'Export CSV',
}: {
  type: ExportType;
  /** Omit to use the current URL's filters (the listing pages keep them there). */
  filters?: Record<string, unknown>;
  label?: string;
}) {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.post<ExportJobDto>('/api/v1/exports', {
        type,
        filters: filters ?? filtersFromParams(new URLSearchParams(searchParams.toString())),
      });
      setMessage('Export queued — we will notify you when the file is ready.');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not queue the export.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void request()}>
          {busy ? 'Queueing…' : label}
        </Button>
        <Link
          href="/exports"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Exports
        </Link>
      </div>
      {message ? (
        <p role="status" className="text-xs text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
