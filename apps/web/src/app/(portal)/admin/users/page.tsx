import { redirect } from 'next/navigation';

/** The staff directory moved to /admin/staff; keep old links working. */
export default function LegacyStaffPage() {
  redirect('/admin/staff');
}
