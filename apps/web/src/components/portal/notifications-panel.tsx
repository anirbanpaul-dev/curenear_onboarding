'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { NotificationDto, NotificationListResult } from '@curenear/shared';
import { Badge, Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface NotificationsPanelProps {
  role: 'ADMIN' | 'STAFF';
}

function linkFor(notification: NotificationDto, role: 'ADMIN' | 'STAFF'): string {
  if (notification.entityType === 'provider_organization' && notification.entityId) {
    return role === 'ADMIN' ? `/admin/review/${notification.entityId}` : '/staff/providers';
  }
  return '/notifications';
}

/** The caller's own notifications, newest first, with per-item read tracking. */
export function NotificationsPanel({ role }: NotificationsPanelProps) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        ...(unreadOnly ? { unread: 'true' } : {}),
      });
      const response = await fetch(`/api/v1/notifications?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load notifications');
      setData(body.data as NotificationListResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications');
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(ids?: string[]) {
    setBusy(true);
    try {
      await fetch('/api/v1/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={unreadOnly ? 'default' : 'outline'}
            onClick={() => {
              setPage(1);
              setUnreadOnly((current) => !current);
            }}
          >
            {unreadOnly ? 'Unread only' : 'All notifications'}
          </Button>
          {data ? (
            <Badge tone={data.unread > 0 ? 'info' : 'neutral'}>{data.unread} unread</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            className="text-sm text-muted-foreground underline"
            href="/notifications/preferences"
          >
            Preferences
          </Link>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (data?.unread ?? 0) === 0}
            onClick={() => void markRead()}
          >
            Mark all read
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Card>
        <CardContent className="divide-y p-0">
          {data?.rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Nothing here yet. Notifications appear when a provider is submitted, a decision is
              recorded, or a document is about to expire.
            </p>
          ) : null}
          {data?.rows.map((notification) => (
            <div
              key={notification.id}
              className={`flex flex-wrap items-start justify-between gap-3 p-4 ${
                notification.readAt ? 'bg-card' : 'bg-sky-50/50'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {notification.title}
                  {notification.readAt ? null : (
                    <span className="ml-2 align-middle">
                      <Badge tone="info">New</Badge>
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  className="text-sm underline"
                  href={linkFor(notification, role)}
                  onClick={() => {
                    if (!notification.readAt) void markRead([notification.id]);
                  }}
                >
                  Open
                </Link>
                {notification.readAt ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void markRead([notification.id])}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{data ? `${data.total} notification(s)` : ''}</span>
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
    </div>
  );
}
