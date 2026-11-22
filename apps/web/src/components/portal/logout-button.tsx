'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/api/auth/logout');
        } finally {
          router.replace('/login');
          router.refresh();
        }
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
