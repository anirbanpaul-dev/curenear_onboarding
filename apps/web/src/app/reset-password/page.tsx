import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { BrandLogo } from '@/components/brand/brand-logo';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <BrandLogo size={36} />
        <h1 className="mt-4 text-2xl font-semibold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link works once and expires 30 minutes after it was sent.
        </p>
      </div>
      <ResetPasswordForm token={token ?? ''} />
    </main>
  );
}
