import { requirePermission } from '@/server/session';
import { JobHistory } from '@/components/admin/job-history';

export const dynamic = 'force-dynamic';

export default async function AdminJobHistoryPage() {
  await requirePermission('system.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Job history</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every scheduled run of the expiry scan, stale draft reminders, outbox cleanup, session
          cleanup, webhook delivery and the PIN-stats consistency check.
        </p>
      </div>
      <JobHistory />
    </div>
  );
}
