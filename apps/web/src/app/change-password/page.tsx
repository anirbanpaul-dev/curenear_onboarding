import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/session';
import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { BrandLogo } from '@/components/brand/brand-logo';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getCurrentUser();
  if (!session) redirect('/login');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <BrandLogo size={36} />
        <h1 className="mt-4 text-2xl font-semibold">
          {session.mustChangePassword ? 'Choose a new password' : 'Change your password'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {session.user.email}. Changing your password signs out your other devices.
        </p>
      </div>
      <ChangePasswordForm forced={session.mustChangePassword} />
    </main>
  );
}
