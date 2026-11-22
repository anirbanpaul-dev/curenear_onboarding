'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export interface TopBarProps {
  name: string;
  email: string;
  role: 'ADMIN' | 'STAFF';
}

export function TopBar({ name, email, role }: TopBarProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<'logout' | 'logout-all' | null>(null);
  const [unread, setUnread] = useState(0);

  // The bell is best-effort: a failed poll must never break the header.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/v1/notifications/unread');
        if (!response.ok) return;
        const body = await response.json();
        if (!cancelled) setUnread(Number(body?.data?.unread ?? 0));
      } catch {
        // Ignore; the next poll tries again.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function signOut(allDevices: boolean) {
    setBusy(allDevices ? 'logout-all' : 'logout');
    try {
      await api.post(allDevices ? '/api/auth/logout-all' : '/api/auth/logout');
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-3">
      <Link href="/" className="flex items-center gap-2">
        <Image src="/logo.png" alt="" width={26} height={26} priority className="shrink-0" />
        <span className="text-sm font-semibold tracking-tight">
          CureNear <span className="text-muted-foreground">Onboarding</span>
        </span>
      </Link>

      <Link href="/notifications" className="relative rounded-md px-2 py-1.5 hover:bg-accent">
        <span aria-hidden="true">🔔</span>
        <span className="sr-only">Notifications{unread > 0 ? ` (${unread} unread)` : ''}</span>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 right-0 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Link>

      <details className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-2 py-1 hover:bg-accent">
          <span className="text-right">
            <span className="block text-sm font-medium leading-tight">{name}</span>
            <span className="block text-xs uppercase tracking-wide text-muted-foreground">
              {role === 'ADMIN' ? 'Administrator' : 'Onboarding staff'}
            </span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ▾
          </span>
        </summary>

        <div className="absolute right-0 z-20 mt-2 w-60 rounded-md border bg-card p-3 shadow-md">
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <div className="mt-3 space-y-1">
            <Link
              href="/change-password"
              className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              Change password
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2"
              disabled={busy !== null}
              onClick={() => signOut(false)}
            >
              {busy === 'logout' ? 'Signing out…' : 'Sign out'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2"
              disabled={busy !== null}
              onClick={() => signOut(true)}
            >
              {busy === 'logout-all' ? 'Signing out…' : 'Sign out of all devices'}
            </Button>
          </div>
        </div>
      </details>
    </header>
  );
}
