import { notFound } from 'next/navigation';
import { AppError } from '@curenear/shared';
import { requirePermission } from '@/server/session';
import { getServices } from '@/server/services';
import { ReviewDetailView } from '@/components/admin/review-detail';

export const dynamic = 'force-dynamic';

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission('provider.review');
  const { id } = await params;

  try {
    const detail = await getServices().reviews.detail(session.actor, id);
    return <ReviewDetailView initial={detail} />;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}
