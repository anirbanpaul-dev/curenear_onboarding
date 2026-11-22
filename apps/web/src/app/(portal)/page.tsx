import { redirect } from 'next/navigation';
import { homePathForRole, requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

/** `/` is only a router: admins go to /admin, staff to /staff. */
export default async function PortalHomePage() {
  const session = await requireUser();
  redirect(homePathForRole(session.user.role));
}
