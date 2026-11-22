import Link from 'next/link';
import { getCurrentUser, homePathForRole } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage() {
  const session = await getCurrentUser();
  const home = session ? homePathForRole(session.user.role) : '/login';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">403</p>
      <h1 className="mt-2 text-2xl font-semibold">You do not have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {session
          ? `Signed in as ${session.user.email}. Ask an administrator if you need this area.`
          : 'Sign in with an account that has access.'}
      </p>
      <div className="mt-6 flex gap-4 text-sm">
        <Link href={home} className="underline underline-offset-4">
          Go to your dashboard
        </Link>
        <Link href="/login" className="text-muted-foreground underline underline-offset-4">
          Sign in as someone else
        </Link>
      </div>
    </main>
  );
}
