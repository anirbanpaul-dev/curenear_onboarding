import Link from 'next/link';
import { requireUser } from '@/server/session';
import { StartProviderForm } from '@/components/onboarding/start-form';

export const dynamic = 'force-dynamic';

export default async function NewStaffProviderPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/staff/providers"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to my providers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Onboard a provider</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the provider type and capture the legal name, mobile and primary PIN. Duplicate
          warnings appear before the draft is created; the rest of the details go in the next step.
        </p>
      </div>
      <StartProviderForm />
    </div>
  );
}
