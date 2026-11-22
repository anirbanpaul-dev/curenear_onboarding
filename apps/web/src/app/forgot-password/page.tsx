import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { BrandLogo } from '@/components/brand/brand-logo';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8">
        <BrandLogo size={36} />
        <h1 className="mt-4 text-2xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your work email and we will send a single-use link.
        </p>
      </div>
      <ForgotPasswordForm />
    </main>
  );
}
