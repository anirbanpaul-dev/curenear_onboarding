import { notFound } from 'next/navigation';
import { AppError } from '@curenear/shared';
import { requireUser } from '@/server/session';
import { getServices } from '@/server/services';
import { OnboardingWizard } from '@/components/onboarding/wizard';
import type { OrganizationDetailDto } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EditStaffProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;

  let detail;
  try {
    detail = await getServices().onboarding.get(session.actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  // Dates cross the server/client boundary as ISO strings.
  const serialized = JSON.parse(JSON.stringify(detail)) as OrganizationDetailDto;

  return <OnboardingWizard initial={serialized} />;
}
