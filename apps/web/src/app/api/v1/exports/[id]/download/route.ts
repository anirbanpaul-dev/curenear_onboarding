import { NextResponse, type NextRequest } from 'next/server';
import { AppError, exportDownloadParamsSchema } from '@curenear/shared';
import { clientIp, jsonFailure, resolveRequestId } from '@/server/http';
import { getCurrentUser } from '@/server/session';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/exports/:id/download
 *
 * The stable link in the notification. It checks the session, ownership and
 * expiry, then redirects to a five-minute presigned GET. Every download is
 * audited; the object itself is never proxied through the app.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = resolveRequestId(req);
  try {
    const session = await getCurrentUser();
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');

    const { id } = await context.params;
    const parsed = exportDownloadParamsSchema.safeParse({ id });
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Export not found');

    const result = await getServices().exports.download(session.actor, parsed.data.id, {
      requestId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return NextResponse.redirect(result.url, 302);
  } catch (error) {
    return jsonFailure(error, requestId);
  }
}
