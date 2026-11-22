export const dynamic = 'force-dynamic';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  // Authentication already runs once in the parent portal layout; staff and
  // administrators both use these screens, so no extra role check is needed.
  return children;
}
