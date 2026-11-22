import { hashPassword } from '@curenear/db';
import {
  AppError,
  assertAuthorized,
  outboxEventVersions,
  pageMeta,
  type Actor,
  type CreateUserInput,
  type ListUsersQuery,
  type UserRecord,
} from '@curenear/shared';
import type { RequestContext, ServiceDeps } from './service-deps';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

export interface UserListResult {
  rows: UserRecord[];
  meta: ReturnType<typeof pageMeta>;
}

export function createUserService(
  deps: Pick<ServiceDeps, 'repositories' | 'unitOfWork' | 'now' | 'newId'>,
) {
  const { repositories, unitOfWork, now, newId } = deps;

  return {
    async list(actor: Actor, query: ListUsersQuery): Promise<UserListResult> {
      assertAuthorized(actor, 'user:read');
      const { rows, total } = await repositories.users.list({
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        rows,
        meta: pageMeta({
          page: query.page,
          pageSize: query.pageSize,
          total,
          sort: 'name',
          order: 'asc',
        }),
      };
    },

    async create(actor: Actor, input: CreateUserInput, ctx: RequestContext): Promise<UserRecord> {
      assertAuthorized(actor, 'user:create');

      const existing = await repositories.users.findByEmail(input.email);
      if (existing) {
        throw new AppError('CONFLICT', 'A user with this email already exists');
      }

      const passwordHash = await hashPassword(input.temporaryPassword);

      try {
        return await unitOfWork.transaction(async (tx) => {
          const user = await tx.users.create({
            id: newId(),
            email: input.email,
            name: input.name,
            passwordHash,
            role: input.role,
            // Temporary passwords must be replaced at first sign-in.
            mustChangePassword: true,
          });

          await tx.audits.append({
            id: newId(),
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'user.created',
            entityType: 'user',
            entityId: user.id,
            requestId: ctx.requestId,
            changedFieldKeys: ['email', 'name', 'role'],
            fromStatus: null,
            toStatus: null,
            reason: null,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            createdAt: now(),
          });

          await tx.outbox.append({
            id: newId(),
            eventType: 'user.created',
            eventVersion: outboxEventVersions['user.created'],
            aggregateType: 'user',
            aggregateId: user.id,
            payload: { userId: user.id, role: user.role, actorUserId: actor.userId },
            occurredAt: now(),
          });

          return user;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', 'A user with this email already exists');
        }
        throw error;
      }
    },

    async deactivate(
      actor: Actor,
      userId: string,
      reason: string,
      ctx: RequestContext,
    ): Promise<UserRecord> {
      assertAuthorized(actor, 'user:deactivate');
      if (userId === actor.userId) {
        throw new AppError('CONFLICT', 'You cannot deactivate your own account');
      }

      return unitOfWork.transaction(async (tx) => {
        const user = await tx.users.softDelete({ id: userId, deletedAt: now() });
        if (!user) throw new AppError('NOT_FOUND', 'User not found');

        await tx.audits.append({
          id: newId(),
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'user.deactivated',
          entityType: 'user',
          entityId: user.id,
          requestId: ctx.requestId,
          changedFieldKeys: [],
          fromStatus: null,
          toStatus: null,
          reason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          createdAt: now(),
        });

        return user;
      });
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
