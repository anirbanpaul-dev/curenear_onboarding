import { describe, expect, it } from 'vitest';
import {
  emailSubjectFor,
  isNotifiableEvent,
  markNotificationsReadSchema,
  notificationPreferenceCatalogue,
  notificationPreferencesSchema,
  notificationTypes,
  notificationsQuerySchema,
  portalPathFor,
  preferenceOption,
  renderNotificationEmail,
} from './notifications';

describe('notification catalogue', () => {
  it('has unique types with complete preference defaults', () => {
    expect(notificationTypes.length).toBeGreaterThan(5);
    expect(new Set(notificationTypes).size).toBe(notificationTypes.length);
    for (const option of notificationPreferenceCatalogue) {
      expect(option.label, option.type).toBeTruthy();
      expect(option.description, option.type).toBeTruthy();
      expect(typeof option.defaultInApp).toBe('boolean');
      expect(typeof option.defaultEmail).toBe('boolean');
    }
  });

  it('falls back to a notifiable-by-default option for unknown types', () => {
    expect(preferenceOption('provider.approved').type).toBe('provider.approved');
    expect(preferenceOption('future.event')).toMatchObject({
      type: 'future.event',
      label: 'future.event',
      defaultInApp: true,
      defaultEmail: true,
    });
    expect(isNotifiableEvent('provider.approved')).toBe(true);
    expect(isNotifiableEvent('future.event')).toBe(false);
  });

  it('prefixes actionable subjects but keeps plain titles clean', () => {
    expect(emailSubjectFor('provider.approved', 'Clinic approved')).toBe(
      '[CureNear] Approved: Clinic approved',
    );
    expect(emailSubjectFor('document.expiring', 'Licence expires')).toBe(
      '[CureNear] Document expiring: Licence expires',
    );
    expect(emailSubjectFor('unknown.event', 'Hello')).toBe('[CureNear] Hello');
  });

  it('routes each entity to its portal page', () => {
    expect(portalPathFor('provider_organization', 'abc')).toBe('/admin/review/abc');
    expect(portalPathFor('export_job', 'abc')).toBe('/exports');
    expect(portalPathFor('provider_organization', null)).toBe('/notifications');
    expect(portalPathFor(undefined, undefined)).toBe('/notifications');
  });

  it('renders a plain-text email with an absolute portal link', () => {
    const email = renderNotificationEmail({
      type: 'provider.submitted',
      title: 'New application',
      body: 'A clinic submitted its profile.',
      entityType: 'provider_organization',
      entityId: '11111111-1111-4111-8111-111111111111',
      appUrl: 'https://portal.curenear.in/',
    });
    expect(email.subject).toBe('[CureNear] New application submitted: New application');
    expect(email.text).toContain('A clinic submitted its profile.');
    expect(email.text).toContain(
      'Open CureNear: https://portal.curenear.in/admin/review/11111111-1111-4111-8111-111111111111',
    );
    expect(email.text).not.toContain('//admin');

    const exportMail = renderNotificationEmail({
      type: 'export.ready',
      title: 'Export ready',
      body: 'Download it.',
      entityType: 'export_job',
      entityId: 'job-1',
      appUrl: 'http://localhost:3000',
    });
    expect(exportMail.text).toContain('Open CureNear: http://localhost:3000/exports');
  });

  it('parses notification list and preference payloads strictly', () => {
    expect(notificationsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(notificationsQuerySchema.parse({ unread: 'true', page: '2' })).toMatchObject({
      unread: 'true',
      page: 2,
    });
    expect(notificationsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(notificationsQuerySchema.safeParse({ extra: 'x' }).success).toBe(false);

    expect(markNotificationsReadSchema.parse({})).toEqual({});
    expect(
      markNotificationsReadSchema.safeParse({
        ids: ['11111111-1111-4111-8111-111111111111'],
      }).success,
    ).toBe(true);
    expect(markNotificationsReadSchema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);

    expect(
      notificationPreferencesSchema.safeParse({
        preferences: [{ type: 'provider.approved', in_app: true, email: false }],
      }).success,
    ).toBe(true);
    expect(
      notificationPreferencesSchema.safeParse({
        preferences: [{ type: 'provider.approved', in_app: 'yes' }],
      }).success,
    ).toBe(false);
  });
});
