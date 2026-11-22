'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await api.post<{ message: string }>('/api/auth/forgot-password', values);
      setSent(data.message);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Could not send the link. Try again.',
      );
    }
  });

  if (sent) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <p role="status" className="text-sm">
          {sent}
        </p>
        <p className="text-xs text-muted-foreground">
          The link expires in 30 minutes and can only be used once.
        </p>
        <Link href="/login" className="text-sm underline underline-offset-4">
          Back to sign in
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

      <div>
        <Label htmlFor="email" required>
          Work email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          aria-invalid={Boolean(errors.email)}
          {...register('email')}
        />
        {errors.email ? (
          <p className="field-error" role="alert">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send reset link'}
      </Button>

      <Link
        href="/login"
        className="block text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
