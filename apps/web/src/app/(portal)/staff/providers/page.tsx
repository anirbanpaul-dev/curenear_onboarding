import Link from 'next/link';
import { requireUser } from '@/server/session';
import { buttonVariants } from '@/components/ui/button';
import { StaffDirectory } from '@/components/staff/staff-directory';
import { ExportButton } from '@/components/exports/export-button';

export const dynamic = 'force-dynamic';

export default async function StaffProvidersPage() {
  const session = await requireUser();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only providers you onboarded. Drafts and returned submissions open for editing;
            submitted records open read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton type="providers" label="Export my providers" />
          <Link href="/staff/providers/new" className={buttonVariants()}>
            Onboard a provider
          </Link>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Signed in as {session.user.name}. Records created by other staff members are not listed
        here.
      </p>

      <StaffDirectory />
    </div>
  );
}
