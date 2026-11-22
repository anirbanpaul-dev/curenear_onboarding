import { requireUser } from '@/server/session';
import { NotificationPreferences } from '@/components/portal/notification-preferences';

export const dynamic = 'force-dynamic';

export default async function NotificationPreferencesPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how each kind of notification reaches you. These settings apply to your account
          only and take effect for the next event.
        </p>
      </div>
      <NotificationPreferences />
    </div>
  );
}
