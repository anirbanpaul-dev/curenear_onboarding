'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationPreferenceDto } from '@curenear/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Per-user choices for each notification type: in-app and email. */
export function NotificationPreferences() {
  const [rows, setRows] = useState<NotificationPreferenceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/v1/notifications/preferences');
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Could not load preferences');
      return;
    }
    setRows(body.data as NotificationPreferenceDto[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(type: string, field: 'inApp' | 'email') {
    setMessage(null);
    setRows((current) =>
      current.map((row) => (row.type === type ? { ...row, [field]: !row[field] } : row)),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preferences: rows.map((row) => ({
            type: row.type,
            in_app: row.inApp,
            email: row.email,
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not save preferences');
      setRows(body.data as NotificationPreferenceDto[]);
      setMessage('Preferences saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save preferences');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b bg-secondary/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Notification</span>
            <span className="text-center">In-app</span>
            <span className="text-center">Email</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.type}
              className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b px-4 py-3 last:border-b-0"
            >
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.description}</p>
              </div>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label={`${row.label} in-app`}
                  checked={row.inApp}
                  onChange={() => toggle(row.type, 'inApp')}
                />
              </label>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label={`${row.label} email`}
                  checked={row.email}
                  onChange={() => toggle(row.type, 'email')}
                />
              </label>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={() => void save()} disabled={busy || rows.length === 0}>
        {busy ? 'Saving…' : 'Save preferences'}
      </Button>
    </div>
  );
}
