'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginResponse {
  mustChangePassword: boolean;
  redirectTo: string;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { data } = await api.post<LoginResponse>('/api/auth/login', values);
      // The server decides: forced password change first, then the role home.
      const requested = searchParams.get('next');
      const target = data.mustChangePassword || !requested ? data.redirectTo : requested;
      router.replace(target.startsWith('/') ? target : data.redirectTo);
      router.refresh();
    } catch (error) {
      setFormError(
        error instanceof ApiClientError ? error.message : 'Could not sign in. Try again.',
      );
    }
  });

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border bg-card p-6 shadow-sm"
      noValidate
    >
      {formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
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
          aria-required="true"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
        {errors.email ? (
          <p id="email-error" className="field-error" role="alert">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password" required>
            Password
          </Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-required="true"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
        {errors.password ? (
          <p id="password-error" className="field-error" role="alert">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
