import { createHash, randomInt } from 'node:crypto';
import { AppError, type ConsentMethod } from '@curenear/shared';
import { logger } from '@/lib/logger';

/**
 * Pluggable consent confirmation. The provider only decides how a one-time code
 * is delivered; the consent service owns what gets recorded.
 */
export interface OtpChallenge {
  codeHash: string;
  phone: string;
  maskedPhone: string;
  expiresAt: Date;
  attemptsLeft: number;
}

export interface ConfirmationProvider {
  readonly method: ConsentMethod;
  /** False when the channel is not configured; the UI hides it. */
  readonly available: boolean;
  requestOtp(input: { phone: string; now: Date; ttlMinutes?: number }): Promise<OtpChallenge>;
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '******';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Default: staff attest that the provider confirmed in person, signing the
 * printed declaration. No code is sent.
 */
export function createInPersonAttestationProvider(): ConfirmationProvider {
  return {
    method: 'IN_PERSON_ATTESTATION',
    available: true,
    async requestOtp() {
      throw new AppError(
        'VALIDATION_ERROR',
        'In-person attestation does not send a code; tick the declarations with the provider present.',
      );
    },
  };
}

/**
 * SMS OTP stub (Prompt 15). In development the code is written to the log so the
 * flow can be exercised; production refuses until a real SMS provider is wired.
 */
export function createSmsOtpProvider(options: {
  environment: string;
  send?: (input: { phone: string; code: string }) => Promise<void>;
}): ConfirmationProvider {
  const available = options.environment !== 'production' || Boolean(options.send);
  return {
    method: 'OTP',
    available,
    async requestOtp({ phone, now, ttlMinutes = 10 }) {
      if (!available) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'SMS delivery is not configured. Use in-person attestation or a signed form.',
        );
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (options.send) {
        await options.send({ phone, code });
      } else {
        logger.info({ phone: maskPhone(phone), code }, 'confirmation_otp_development');
      }
      return {
        codeHash: hashOtp(code),
        phone,
        maskedPhone: maskPhone(phone),
        expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
        attemptsLeft: 5,
      };
    },
  };
}
