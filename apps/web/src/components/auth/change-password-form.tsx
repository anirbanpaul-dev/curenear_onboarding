'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { PasswordField } from './password-field';

interface ChangePasswordResponse {
  user: { role: 'ADMIN' | 'STAFF' };
}

function firstIssue(error: ApiClientError, field: string): string | undefined {
  const details = error.details;
  if (Array.isArray(details)) {
    const match = details.find(
      (issue): issue is { path: string; message: string } =>
        typeof issue === 'object' &&
        issue !== null &&
        'path' in issue &&
        (issue as { path: unknown }).path === field,
    );
    if (match) return match.message;
  }
  return undefined;
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'The two passwords do not match' });
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post<ChangePasswordResponse>('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      router.replace(data.user.role === 'ADMIN' ? '/admin' : '/staff');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors({
          currentPassword: firstIssue(error, 'currentPassword'),
          newPassword: firstIssue(error, 'newPassword'),
        });
        if (!firstIssue(error, 'currentPassword') && !firstIssue(error, 'newPassword')) {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not change your password. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} method="post" className="space-y-5" noValidate>
      {forced ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This account is still on a temporary password. Choose your own before continuing.
        </p>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      ) : null}

      <PasswordField
        id="currentPassword"
        label="Current password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={setCurrentPassword}
        error={fieldErrors.currentPassword}
        hint="The password you signed in with."
      />

      <PasswordField
        id="newPassword"
        label="New password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
        error={fieldErrors.newPassword}
      />

      <PasswordField
        id="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        error={fieldErrors.confirmPassword}
        hint="Re-enter the new password."
      />

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
