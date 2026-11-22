'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WebhookEndpointDto } from '@curenear/shared';
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

/**
 * Minimal subscriber registry: add an https URL and optionally narrow it to a
 * comma-separated list of event types. Leaving the list blank subscribes to
 * every event. Deliveries start with the next published event.
 */
export function WebhookEndpoints() {
  const [endpoints, setEndpoints] = useState<WebhookEndpointDto[]>([]);
  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/admin/system/webhooks');
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Could not load webhook endpoints');
      return;
    }
    setEndpoints(body.data as WebhookEndpointDto[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const types = eventTypes
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await fetch('/api/v1/admin/system/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          ...(types.length > 0 ? { event_types: types } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not add this endpoint');
      setUrl('');
      setEventTypes('');
      setMessage('Endpoint registered');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this endpoint');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/system/webhooks/${id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not remove this endpoint');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this endpoint');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook endpoints</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every published event that matches a registered endpoint becomes a delivery row. Leave the
          event types blank to receive everything, or name types such as{' '}
          <code>provider.approved, document.expired</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="webhook-url" className="text-xs text-muted-foreground">
              Endpoint URL
            </label>
            <Input
              id="webhook-url"
              className="w-80"
              placeholder="https://hooks.example.com/curenear"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="webhook-types" className="text-xs text-muted-foreground">
              Event types (optional)
            </label>
            <Input
              id="webhook-types"
              className="w-72"
              placeholder="provider.approved, document.expired"
              value={eventTypes}
              onChange={(event) => setEventTypes(event.target.value)}
            />
          </div>
          <Button onClick={() => void add()} disabled={busy || url.trim().length === 0}>
            {busy ? 'Saving…' : 'Add endpoint'}
          </Button>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  No endpoints registered. Events are still published to the internal handlers.
                </TableCell>
              </TableRow>
            ) : null}
            {endpoints.map((endpoint) => (
              <TableRow key={endpoint.id}>
                <TableCell className="font-mono text-xs">{endpoint.url}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {endpoint.eventTypes.length === 0 ? 'All events' : endpoint.eventTypes.join(', ')}
                </TableCell>
                <TableCell>
                  <Badge tone={endpoint.active ? 'success' : 'neutral'}>
                    {endpoint.active ? 'Active' : 'Paused'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void remove(endpoint.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
