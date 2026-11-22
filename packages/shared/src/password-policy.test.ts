import { describe, expect, it } from 'vitest';
import { checkPassword, isAcceptablePassword, MIN_PASSWORD_LENGTH } from './password-policy';

const email = 'asha.rao@curenear.in';

describe('password policy', () => {
  it('accepts a long, uncommon passphrase', () => {
    expect(isAcceptablePassword('chartreuse-otter-42-piano', email)).toBe(true);
  });

  it('rejects anything shorter than 12 characters', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const result = checkPassword(short, email);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('at least 12');
  });

  it('rejects common passwords regardless of case', () => {
    expect(checkPassword('Password12345', email).valid).toBe(false);
    expect(checkPassword('WELCOME123456', email).valid).toBe(false);
    expect(checkPassword('changemeplease', email).valid).toBe(false);
  });

  it('rejects the email address itself, ignoring case', () => {
    const result = checkPassword('Asha.Rao@CureNear.in', email);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('email');
  });

  it('allows an email-like password that is not the address', () => {
    expect(isAcceptablePassword('asha.rao-not-my-email', email)).toBe(true);
  });

  it('allows a strong password without an email to compare against', () => {
    expect(isAcceptablePassword('marigold-anchor-77-tide')).toBe(true);
  });

  it('reports every violation at once', () => {
    const result = checkPassword('short', email);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
