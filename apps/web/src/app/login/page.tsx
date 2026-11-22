import { redirect } from 'next/navigation';
import { getCurrentUser, homePathForRole } from '@/server/session';
import { LoginForm } from '@/components/auth/login-form';
import { BrandLogo } from '@/components/brand/brand-logo';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await getCurrentUser();
  if (session) {
    redirect(session.mustChangePassword ? '/change-password' : homePathForRole(session.user.role));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <BrandLogo size={36} />
        <h1 className="mt-4 text-2xl font-semibold">Provider onboarding portal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Internal access for CureNear administrators and onboarding staff.
        </p>
      </div>
      <LoginForm />
      <p className="mt-6 text-xs text-muted-foreground">
        Accounts are created by an administrator. Providers do not sign in to this portal.
      </p>
    </main>
  );
}
