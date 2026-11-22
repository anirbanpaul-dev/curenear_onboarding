'use client';

import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
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
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PincodeDto, PincodeImportSummaryDto, PincodeStatsDto } from '@/lib/types';

/**
 * PIN code tab: browser upload of the India Post CSV (same importer as
 * scripts/import-pincodes.ts) plus a read-only search over what was imported.
 */
export function PincodePanel({ stats: initialStats }: { stats: PincodeStatsDto }) {
  const [stats, setStats] = useState(initialStats);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PincodeDto[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<PincodeImportSummaryDto | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function upload(): Promise<void> {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dryRun', dryRun ? 'true' : 'false');
      const result = await api.postForm<PincodeImportSummaryDto>(
        '/api/v1/admin/master/pincodes/import',
        form,
      );
      setSummary(result.data);
      // A dry run writes nothing, so the status cards keep their values.
      if (!dryRun) setStats(result.data.stats);
    } catch (error) {
      setImportError(
        error instanceof ApiClientError ? error.message : 'The import could not be completed.',
      );
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setRows([]);
      setState('idle');
      return;
    }

    let cancelled = false;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<PincodeDto[]>(
          `/api/v1/master/pincodes/search?q=${encodeURIComponent(needle)}`,
        );
        if (cancelled) return;
        setRows(result.data);
        setState('done');
      } catch {
        if (!cancelled) setState('error');
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Import the directory</CardTitle>
          <CardDescription>
            Upload the official India Post CSV from{' '}
            <a
              href="https://www.data.gov.in/catalog/all-india-pincode-directory"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              data.gov.in
            </a>
            . Re-uploading the same file is safe: matching rows are reported as unchanged, never
            duplicated. See docs/pincode-import.md for the expected columns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor="pincode-file">CSV file</Label>
              <input
                id="pincode-file"
                type="file"
                accept=".csv,text/csv"
                disabled={importing}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full rounded-md border bg-card px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm"
              />
              <p className="field-help">
                {file
                  ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`
                  : 'all_india_pin_code.csv, up to 25 MB'}
              </p>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dryRun}
                  disabled={importing}
                  onChange={(event) => setDryRun(event.target.checked)}
                />
                Validate only (no writes)
              </label>
              <Button
                onClick={() => void upload()}
                disabled={importing || !file}
                data-testid="import-pincodes"
              >
                {importing ? 'Importing…' : dryRun ? 'Validate file' : 'Import PIN codes'}
              </Button>
            </div>
          </div>

          {importing ? (
            <p className="text-sm text-muted-foreground">
              Reading and importing the file — the full all-India file can take a minute…
            </p>
          ) : null}

          {importError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {importError}
            </p>
          ) : null}

          {summary ? (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
            >
              <p className="font-medium">
                {summary.dryRun ? 'Validation only' : 'Import finished'} — {summary.fileName}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <Count label="Rows read" value={summary.rowsRead} />
                <Count label="Added" value={summary.added} testId="import-added" />
                <Count label="Updated" value={summary.updated} />
                <Count label="Unchanged" value={summary.unchanged} />
                <Count label="Skipped" value={summary.skipped} />
                <Count label="Districts new" value={summary.districtsCreated} />
                <Count label="States matched" value={summary.statesMatched} />
                <Count label="Seconds" value={(summary.durationMs / 1000).toFixed(1)} />
              </dl>
              {Object.keys(summary.skippedReasons).length > 0 ? (
                <p className="mt-1 text-xs">
                  Skipped:{' '}
                  {Object.entries(summary.skippedReasons)
                    .map(([reason, count]) => `${reason} ${count}`)
                    .join(' · ')}
                </p>
              ) : null}
              {summary.unknownStates.length > 0 ? (
                <p className="mt-1 text-xs">
                  No matching seeded state for: {summary.unknownStates.join(', ')} — add those
                  states and re-upload.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>
            Read-only: to correct an entry, upload a fresh CSV rather than editing rows here.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border bg-secondary/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">PIN codes</p>
            <p className="mt-1 text-2xl font-semibold">{stats.totalPins.toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-md border bg-secondary/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Districts</p>
            <p className="mt-1 text-2xl font-semibold">
              {stats.totalDistricts.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="rounded-md border bg-secondary/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last import</p>
            <p className="mt-1 text-sm font-medium">
              {stats.totalPins === 0 ? 'Not imported yet' : formatDateTime(stats.lastUpdatedAt)}
            </p>
            {stats.totalPins === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                See docs/pincode-import.md for the download link.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>Prefix search on the PIN code or the office name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-sm">
            <Label htmlFor="pincode-search">PIN or office</Label>
            <Input
              id="pincode-search"
              placeholder="7000"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {state === 'loading' ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
          {state === 'error' ? (
            <p className="text-sm text-destructive">Could not search the directory.</p>
          ) : null}
          {state === 'done' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PIN</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No PIN codes match that search.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.pinCode}>
                    <TableCell className="font-mono text-xs">{row.pinCode}</TableCell>
                    <TableCell>{row.officeName}</TableCell>
                    <TableCell>{row.districtName ?? '—'}</TableCell>
                    <TableCell>{row.stateName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Count({
  label,
  value,
  testId,
}: {
  label: string;
  value: number | string;
  testId?: string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-emerald-900/80">{label}</dt>
      <dd className="font-mono" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
