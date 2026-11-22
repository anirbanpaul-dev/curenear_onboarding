import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/session';
import { getServices } from '@/server/services';
import { renderAgreementPdf } from '@/server/documents/pdf';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid(), templateId: z.string().uuid() });

/** The pre-filled agreement PDF the provider prints, signs and uploads back. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; templateId: string }> },
) {
  const session = await getCurrentUser();
  if (!session) return new Response('Sign in to continue', { status: 401 });

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return new Response('Not found', { status: 404 });

  const agreement = await getServices()
    .consents.renderAgreement(session.actor, parsed.data.id, parsed.data.templateId)
    .catch(() => null);
  if (!agreement) return new Response('Not found', { status: 404 });

  const pdf = renderAgreementPdf({
    title: agreement.template.name,
    subtitle: `${agreement.template.version} · effective ${agreement.template.effectiveFrom
      .toISOString()
      .slice(0, 10)} · ${agreement.template.bodyHash.slice(0, 12)}`,
    body: agreement.body,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${agreement.fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
