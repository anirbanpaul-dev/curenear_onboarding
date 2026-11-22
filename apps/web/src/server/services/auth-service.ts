import {
  generateResetToken,
  getDummyPasswordHash,
  generateSessionToken,
  hashPassword,
  hashResetToken,
  hashSessionToken,
  passwordNeedsRehash,
  verifyPassword,
} from '@curenear/db';
import {
  AppError,
  checkPassword,
  type Actor,
  type SessionRecord,
  type UserAuthRecord,
  type UserRecord,
} from '@curenear/shared';
import type { EmailService } from '@/server/email';
import type { RateLimiter } from '@/server/auth/rate-limiter';
import type { RequestContext, ServiceDeps } from './service-deps';

/** Session rules: 8 hours per session, extended on activity, hard stop at 24h. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_THRESHOLD_MS = 60 * 1000;

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const LOGIN_RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 } as const;
export const RESET_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect';

export interface AuthDeps extends Pick<ServiceDeps, 'repositories' | 'newId' | 'now'> {
  email: EmailService;
  rateLimiter: RateLimiter;
  appUrl: string;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: UserRecord;
  mustChangePassword: boolean;
}

export interface ChangePasswordResult {
  token: string;
  expiresAt: Date;
  user: UserRecord;
}

function toUserRecord(record: UserAuthRecord): UserRecord {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    isActive: record.status === 'ACTIVE',
    createdAt: record.createdAt,
    deletedAt: record.deletedAt,
  };
}

function passwordIssues(errors: string[]): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    errors[0] ?? 'Password does not meet the policy',
    errors.map((message) => ({ path: 'newPassword', message })),
  );
}

export function createAuthService(deps: AuthDeps) {
  const { repositories, newId, now, email, rateLimiter } = deps;

  async function audit(
    action:
      | 'auth.login.succeeded'
      | 'auth.login.failed'
      | 'auth.login.locked'
      | 'auth.login.rate_limited'
      | 'auth.logout'
      | 'auth.logout_all'
      | 'auth.password_changed'
      | 'auth.password_change_failed'
      | 'auth.password_reset_requested'
      | 'auth.password_reset_completed',
    user: { id: string; role: UserRecord['role'] } | null,
    ctx: RequestContext,
  ): Promise<void> {
    await repositories.audits.append({
      id: newId(),
      actorUserId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action,
      entityType: 'user',
      entityId: user?.id ?? 'unknown',
      requestId: ctx.requestId,
      changedFieldKeys: [],
      fromStatus: null,
      toStatus: null,
      reason: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      createdAt: now(),
    });
  }

  async function startSession(
    userId: string,
    at: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateSessionToken();
    const expiresAt = new Date(at.getTime() + SESSION_TTL_MS);
    await repositories.sessions.create({
      id: newId(),
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    return { token, expiresAt };
  }

  return {
    async login(emailAddress: string, password: string, ctx: RequestContext): Promise<LoginResult> {
      const at = now();

      const limit = await rateLimiter.consume(`login:${ctx.ipAddress ?? 'unknown'}`, {
        ...LOGIN_RATE_LIMIT,
        now: at,
      });
      if (!limit.allowed) {
        await audit('auth.login.rate_limited', null, ctx);
        throw new AppError(
          'RATE_LIMITED',
          'Too many sign-in attempts. Wait a few minutes and try again.',
        );
      }

      const user = await repositories.users.findForAuth(emailAddress);

      // Always run a verification so a missing account costs the same time as a
      // wrong password (no account enumeration through timing).
      const hashToCheck = user?.passwordHash ?? (await getDummyPasswordHash());
      const valid = await verifyPassword(password, hashToCheck);
      const generic = new AppError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR);

      if (!user) {
        await audit('auth.login.failed', null, ctx);
        throw generic;
      }

      if (user.status === 'INACTIVE') {
        await audit('auth.login.failed', user, ctx);
        throw generic;
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > at.getTime()) {
        await audit('auth.login.locked', user, ctx);
        throw generic;
      }

      if (!valid) {
        const failedLoginCount = user.failedLoginCount + 1;
        const lockedUntil =
          failedLoginCount >= LOCKOUT_THRESHOLD ? new Date(at.getTime() + LOCKOUT_MS) : null;

        await repositories.users.recordFailedLogin({
          id: user.id,
          failedLoginCount,
          lockedUntil,
        });
        await audit('auth.login.failed', user, ctx);
        if (lockedUntil) await audit('auth.login.locked', user, ctx);
        throw generic;
      }

      await repositories.users.recordSuccessfulLogin({ id: user.id, lastLoginAt: at });

      // Transparent upgrade of hashes written by the old scrypt scheme.
      if (passwordNeedsRehash(user.passwordHash)) {
        await repositories.users.setPassword({
          id: user.id,
          passwordHash: await hashPassword(password),
          mustChangePassword: user.mustChangePassword,
        });
      }

      const { token, expiresAt } = await startSession(user.id, at);
      await audit('auth.login.succeeded', user, ctx);

      return {
        token,
        expiresAt,
        user: toUserRecord(user),
        mustChangePassword: user.mustChangePassword,
      };
    },

    /** Sliding expiry: activity extends the session, capped 24h after sign-in. */
    async resolveSession(token: string | null): Promise<SessionRecord | null> {
      if (!token) return null;
      const at = now();
      const tokenHash = hashSessionToken(token);
      const session = await repositories.sessions.findValidByTokenHash(tokenHash, at);
      if (!session) return null;

      const absoluteDeadline = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
      if (absoluteDeadline <= at.getTime()) {
        await repositories.sessions.revokeByTokenHash(tokenHash, at);
        return null;
      }

      const expiresAt = new Date(Math.min(at.getTime() + SESSION_TTL_MS, absoluteDeadline));
      if (expiresAt.getTime() - session.expiresAt.getTime() > SESSION_SLIDE_THRESHOLD_MS) {
        await repositories.sessions.touch({
          id: session.id,
          lastSeenAt: at,
          expiresAt,
        });
      }

      return { ...session, expiresAt };
    },

    async logout(token: string | null, actor: Actor | null, ctx: RequestContext): Promise<void> {
      if (!token) return;
      await repositories.sessions.revokeByTokenHash(hashSessionToken(token), now());
      if (actor) {
        const user = await repositories.users.findById(actor.userId);
        if (user) await audit('auth.logout', user, ctx);
      }
    },

    async logoutAll(actor: Actor, ctx: RequestContext): Promise<number> {
      const revoked = await repositories.sessions.revokeAllForUser(actor.userId, now());
      await audit('auth.logout_all', { id: actor.userId, role: actor.role }, ctx);
      return revoked;
    },

    async changePassword(
      actor: Actor,
      input: { currentPassword: string; newPassword: string },
      ctx: RequestContext,
    ): Promise<ChangePasswordResult> {
      const at = now();
      const record = await repositories.users.findAuthById(actor.userId);
      if (!record || record.status === 'INACTIVE') {
        throw new AppError('UNAUTHENTICATED', 'Session is no longer valid');
      }

      const currentValid = await verifyPassword(input.currentPassword, record.passwordHash);
      if (!currentValid) {
        await audit('auth.password_change_failed', record, ctx);
        throw new AppError('VALIDATION_ERROR', 'Your current password is incorrect', [
          { path: 'currentPassword', message: 'Your current password is incorrect' },
        ]);
      }

      if (input.newPassword === input.currentPassword) {
        throw passwordIssues(['Choose a password different from your current one']);
      }

      const check = checkPassword(input.newPassword, record.email);
      if (!check.valid) throw passwordIssues(check.errors);

      await repositories.users.setPassword({
        id: record.id,
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
      });

      // Password changes end every other session, including this one; a fresh
      // session is issued for the browser that made the change.
      await repositories.sessions.revokeAllForUser(record.id, at);
      const { token, expiresAt } = await startSession(record.id, at);
      await audit('auth.password_changed', record, ctx);

      return {
        token,
        expiresAt,
        user: toUserRecord({ ...record, mustChangePassword: false }),
      };
    },

    /** Always resolves successfully: never reveals whether the address exists. */
    async requestPasswordReset(emailAddress: string, ctx: RequestContext): Promise<void> {
      const at = now();

      const limit = await rateLimiter.consume(`password-reset:${ctx.ipAddress ?? 'unknown'}`, {
        ...RESET_RATE_LIMIT,
        now: at,
      });
      if (!limit.allowed) return;

      const user = await repositories.users.findForAuth(emailAddress);
      if (!user || user.status === 'INACTIVE') return;

      const token = generateResetToken();
      await repositories.passwordResets.invalidateForUser({ userId: user.id, usedAt: at });
      await repositories.passwordResets.create({
        id: newId(),
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(at.getTime() + RESET_TOKEN_TTL_MS),
      });

      const link = `${deps.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
      await email.send({
        to: user.email,
        subject: 'Reset your CureNear portal password',
        text: [
          `Hello ${user.name},`,
          '',
          'Use the link below to choose a new password. It expires in 30 minutes and works once.',
          '',
          link,
          '',
          'If you did not ask for this, you can ignore this email.',
        ].join('\n'),
      });

      await audit('auth.password_reset_requested', user, ctx);
    },

    async resetPassword(token: string, newPassword: string, ctx: RequestContext): Promise<void> {
      const at = now();

      const limit = await rateLimiter.consume(
        `password-reset-submit:${ctx.ipAddress ?? 'unknown'}`,
        {
          ...RESET_RATE_LIMIT,
          now: at,
        },
      );
      if (!limit.allowed) {
        throw new AppError('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.');
      }

      const record = await repositories.passwordResets.findValid(hashResetToken(token), at);
      const invalid = new AppError(
        'VALIDATION_ERROR',
        'This reset link is invalid or has expired. Request a new one.',
      );
      if (!record) throw invalid;

      const user = await repositories.users.findAuthById(record.userId);
      if (!user || user.status === 'INACTIVE') throw invalid;

      const check = checkPassword(newPassword, user.email);
      if (!check.valid) throw passwordIssues(check.errors);

      await repositories.users.setPassword({
        id: user.id,
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      });
      await repositories.passwordResets.markUsed({ id: record.id, usedAt: at });
      await repositories.passwordResets.invalidateForUser({ userId: user.id, usedAt: at });
      await repositories.sessions.revokeAllForUser(user.id, at);
      await audit('auth.password_reset_completed', user, ctx);
    },

    async getUser(userId: string): Promise<UserRecord | null> {
      return repositories.users.findById(userId);
    },

    /** Removes expired sessions; safe to call at login or from the worker. */
    async pruneSessions(): Promise<number> {
      return repositories.sessions.deleteExpired(now());
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
