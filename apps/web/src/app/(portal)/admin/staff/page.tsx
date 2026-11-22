import { requirePermission } from '@/server/session';
import { StaffDirectory } from '@/components/admin/staff-directory';

export const dynamic = 'force-dynamic';

export default async function AdminStaffPage() {
  const session = await requirePermission('staff.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the accounts that onboard providers. Deactivating someone ends their sessions
          immediately; territory PINs are reference only and never widen what they can see.
        </p>
      </div>
      <StaffDirectory currentUserId={session.actor.userId} />
    </div>
  );
}
