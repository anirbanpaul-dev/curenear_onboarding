import { requirePermission } from '@/server/session';
import { SystemEvents } from '@/components/admin/system-events';
import { WebhookEndpoints } from '@/components/admin/webhook-endpoints';

export const dynamic = 'force-dynamic';

export default async function AdminSystemEventsPage() {
  await requirePermission('system.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System events</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The outbox, newest first. Events that exhaust their retry budget are dead-lettered here;
          fixing the cause and pressing Retry puts them back in the queue.
        </p>
      </div>
      <SystemEvents />
      <WebhookEndpoints />
    </div>
  );
}
