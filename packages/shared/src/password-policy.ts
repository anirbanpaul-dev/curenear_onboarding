/**
 * Password rules for every flow that sets a password: first sign-in change,
 * password reset and admin-created staff accounts.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** Deliberately small: enough to catch the passwords people actually type. */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  'password1234',
  'password12345',
  'passwordpassword',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwerty123456',
  'letmein12345',
  'welcome12345',
  'welcome123456',
  'admin1234567',
  'administrator',
  'iloveyou1234',
  'abc123456789',
  'changeme1234',
  'changemeplease',
  'curenear1234',
  'curenearadmin',
  'india1234567',
  'summer2024!!',
  'winter2024!!',
  'monkey123456',
  'dragon123456',
  'baseball1234',
  'football1234',
  'sunshine1234',
  'princess1234',
  'superman1234',
  'trustno1trustno1',
]);

export interface PasswordCheck {
  valid: boolean;
  errors: string[];
}

/** Returns every violation so the form can show them all at once. */
export function checkPassword(password: string, email?: string | null): PasswordCheck {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Use at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    errors.push('This password is too common. Choose something less predictable');
  }
  if (password.trim().length === 0) {
    errors.push('Enter a password');
  }

  const normalisedEmail = email?.trim().toLowerCase();
  if (normalisedEmail && lower === normalisedEmail) {
    errors.push('Your password cannot be your email address');
  }

  return { valid: errors.length === 0, errors };
}

/** Zod-friendly: `true` when the password passes every rule. */
export function isAcceptablePassword(password: string, email?: string | null): boolean {
  return checkPassword(password, email).valid;
}
