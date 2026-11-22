import { requirePermission } from '@/server/session';
import { AnalyticsDashboard } from '@/components/admin/analytics-dashboard';

export const dynamic = 'force-dynamic';

export default async function AdminAnalyticsPage() {
  await requirePermission('provider.read.all');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Providers per PIN by primary location, the onboarding funnel, staff performance and
          coverage gaps. PIN figures come from the maintained stats table; state, district, owner
          and date filters are computed live from the same definition.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
