import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppError, providerTypeLabels, type DeclarationDefinition } from '@curenear/shared';
import { getServices } from '@/server/services';
import { formatDateTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmForm } from '@/components/confirm/confirm-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Confirm your provider details · CureNear',
  robots: { index: false, follow: false },
};

type ConfirmationView = Awaited<
  ReturnType<ReturnType<typeof getServices>['consents']['getConfirmation']>
>;

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: ConfirmationView;
  try {
    view = await getServices().consents.getConfirmation(token);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const declarations: DeclarationDefinition[] = view.declarations;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">CureNear</p>
        <h1 className="mt-1 text-2xl font-semibold">Confirm your provider details</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {view.organizationName} ({view.providerCode}) · {providerTypeLabels[view.providerType]}
        </p>
      </div>

      {view.state !== 'open' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {view.state === 'used'
                ? 'Already confirmed'
                : view.state === 'expired'
                  ? 'This link has expired'
                  : 'This link was withdrawn'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {view.state === 'used'
              ? 'Your confirmation was recorded. Ask the CureNear staff member to send a new link if anything changed.'
              : 'Ask the CureNear staff member who shared it to send a new confirmation link.'}
            <p className="mt-2 text-xs">
              Expired at {formatDateTime(view.expiresAt.toISOString())}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ConfirmForm
          token={token}
          declarations={declarations}
          hasDoctor={view.hasDoctor}
          expiresAt={view.expiresAt.toISOString()}
        />
      )}
    </main>
  );
}
