import { can, type RbacPermission } from '@curenear/shared';
import { requireUser } from '@/server/session';
import { Sidebar, type NavItem } from '@/components/portal/sidebar';
import { TopBar } from '@/components/portal/top-bar';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Redirects to /login when anonymous and to /change-password while a
  // temporary password is still in place.
  const session = await requireUser();

  const items: Array<NavItem & { permission?: RbacPermission }> = [
    {
      href: session.user.role === 'ADMIN' ? '/admin' : '/staff',
      label: 'Overview',
    },
    { href: '/staff/providers', label: 'My providers' },
    { href: '/admin/providers', label: 'Provider directory', permission: 'provider.read.all' },
    { href: '/admin/review', label: 'Review queue', permission: 'provider.review' },
    { href: '/admin/analytics', label: 'Analytics', permission: 'provider.read.all' },
    { href: '/notifications', label: 'Notifications' },
    { href: '/exports', label: 'Exports' },
    { href: '/admin/staff', label: 'Staff', permission: 'staff.manage' },
    { href: '/admin/master-data', label: 'Master data', permission: 'master.manage' },
    { href: '/admin/system/events', label: 'System events', permission: 'system.manage' },
    { href: '/admin/system/jobs', label: 'Job history', permission: 'system.manage' },
  ];

  const visible: NavItem[] = items
    .filter((item) => !item.permission || can(session.actor, item.permission))
    .map(({ href, label }) => ({ href, label }));

  return (
    <div className="min-h-screen">
      <TopBar name={session.user.name} email={session.user.email} role={session.user.role} />
      <div className="mx-auto flex max-w-7xl">
        <Sidebar items={visible} />
        <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
