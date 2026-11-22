import { describe, expect, it, vi } from 'vitest';
import { preferenceOption, type Actor, type Repositories } from '@curenear/shared';
import { createNotificationService } from './notification-service';

const actor: Actor = { userId: '11111111-1111-4111-8111-111111111111', role: 'STAFF' };
const NOW = new Date('2026-11-22T10:00:00.000Z');

function setup() {
  const repositories = {
    notifications: {
      listForUser: vi.fn(async () => ({
        rows: [
          {
            id: 'n1',
            type: 'provider.approved',
            title: 'Approved',
            body: 'Your clinic is live.',
            entityType: 'provider_organization',
            entityId: 'org-1',
            readAt: NOW,
            createdAt: new Date('2026-11-21T09:00:00.000Z'),
          },
          {
            id: 'n2',
            type: 'export.ready',
            title: 'Export ready',
            body: 'Download it.',
            entityType: 'export_job',
            entityId: 'job-1',
            readAt: null,
            createdAt: new Date('2026-11-20T09:00:00.000Z'),
          },
        ],
        total: 2,
        unread: 1,
      })),
      unreadCount: vi.fn(async () => 4),
      markRead: vi.fn(async () => 2),
      preferences: vi.fn(async () => [{ type: 'provider.approved', inApp: false, email: true }]),
      savePreferences: vi.fn(async () => undefined),
    },
  } as unknown as Repositories;

  return {
    service: createNotificationService({
      repositories,
      unitOfWork: {} as never,
      now: () => NOW,
      newId: () => 'id',
    }),
    repositories,
  };
}

describe('notification service', () => {
  it('pages only the actor’s rows and serialises timestamps', async () => {
    const { service, repositories } = setup();
    const result = await service.list(actor, { page: 3, pageSize: 10, unread: 'true' });

    expect(repositories.notifications.listForUser).toHaveBeenCalledWith(
      actor.userId,
      { skip: 20, take: 10 },
      { unreadOnly: true },
    );
    expect(result).toMatchObject({ total: 2, unread: 1, page: 3, pageSize: 10 });
    expect(result.rows[0]).toMatchObject({
      readAt: NOW.toISOString(),
      createdAt: '2026-11-21T09:00:00.000Z',
    });
    expect(result.rows[1]?.readAt).toBeNull();
  });

  it('returns the unread badge count for the actor only', async () => {
    const { service, repositories } = setup();
    expect(await service.unreadCount(actor)).toEqual({ unread: 4 });
    expect(repositories.notifications.unreadCount).toHaveBeenCalledWith(actor.userId);
  });

  it('marks all or selected rows read and returns the new unread count', async () => {
    const { service, repositories } = setup();
    await expect(service.markRead(actor, {})).resolves.toEqual({ marked: 2, unread: 4 });
    expect(repositories.notifications.markRead).toHaveBeenCalledWith({
      userId: actor.userId,
      readAt: NOW,
    });

    await service.markRead(actor, { ids: ['n1'] });
    expect(repositories.notifications.markRead).toHaveBeenLastCalledWith({
      userId: actor.userId,
      ids: ['n1'],
      readAt: NOW,
    });
  });

  it('merges saved preferences over catalogue defaults', async () => {
    const { service } = setup();
    const preferences = await service.preferences(actor);
    const approved = preferences.find((row) => row.type === 'provider.approved');
    const untouched = preferences.find((row) => row.type !== 'provider.approved');

    expect(approved).toMatchObject({ inApp: false, email: true });
    expect(untouched?.inApp).toBe(preferenceOption(untouched!.type).defaultInApp);
    expect(untouched?.email).toBe(preferenceOption(untouched!.type).defaultEmail);
  });

  it('saves snake_case input as camelCase rows then returns the effective preferences', async () => {
    const { service, repositories } = setup();
    const result = await service.savePreferences(actor, {
      preferences: [{ type: 'provider.approved', in_app: true, email: false }],
    });

    expect(repositories.notifications.savePreferences).toHaveBeenCalledWith(
      actor.userId,
      [{ type: 'provider.approved', inApp: true, email: false }],
      NOW,
    );
    expect(result.find((row) => row.type === 'provider.approved')).toMatchObject({
      inApp: false,
      email: true,
    });
  });
});
