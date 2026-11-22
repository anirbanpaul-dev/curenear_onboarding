import { requireUser } from '@/server/session';
import { NotificationsPanel } from '@/components/portal/notifications-panel';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const session = await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submissions, review decisions, suspensions and document expiry reminders addressed to you.
          The bell in the header shows the unread count.
        </p>
      </div>
      <NotificationsPanel role={session.user.role} />
    </div>
  );
}
