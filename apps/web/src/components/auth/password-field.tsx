'use client';

import { MIN_PASSWORD_LENGTH } from '@curenear/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface PasswordFieldProps {
  id: string;
  label: string;
  autoComplete: 'new-password' | 'current-password';
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
}

export function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  error,
  hint,
}: PasswordFieldProps) {
  return (
    <div>
      <Label htmlFor={id} required>
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-required="true"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
      />
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint ?? `At least ${MIN_PASSWORD_LENGTH} characters, not a common password.`}
        </p>
      )}
    </div>
  );
}
