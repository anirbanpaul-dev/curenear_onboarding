import { requirePermission } from '@/server/session';
import { ReviewQueue } from '@/components/admin/review-queue';

export const dynamic = 'force-dynamic';

export default async function AdminReviewPage() {
  await requirePermission('provider.review');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submitted providers, oldest first. Ageing follows the SLA thresholds configured below;
          approving requires every required checklist item to be verified or marked not applicable.
        </p>
      </div>
      <ReviewQueue />
    </div>
  );
}
