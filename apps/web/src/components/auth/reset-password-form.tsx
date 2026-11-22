'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { PasswordField } from './password-field';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);

    if (password !== confirmPassword) {
      setFieldError('The two passwords do not match');
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      router.replace('/login?reset=1');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const details = caught.details;
        const issue =
          Array.isArray(details) && details.length > 0
            ? (details[0] as { message?: string }).message
            : undefined;
        if (issue) setFieldError(issue);
        else setError(caught.message);
      } else {
        setError('Could not reset the password. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-sm">This reset link is missing its token.</p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-4">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      className="space-y-5 rounded-lg border bg-card p-6 shadow-sm"
      noValidate
    >
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <PasswordField
        id="password"
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={fieldError}
      />
      <PasswordField
        id="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        hint="Re-enter the new password."
      />

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
