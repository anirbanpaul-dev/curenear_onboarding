import type { NextRequest } from 'next/server';
import { clinicDoctorSearchSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/** Duplicate detection before a clinic creates a new doctor profile. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse(params);
    const query = clinicDoctorSearchSchema.parse({
      registration_no: req.nextUrl.searchParams.get('registration_no') ?? '',
      council: req.nextUrl.searchParams.get('council') ?? undefined,
    });
    return { data: await getServices().onboarding.searchClinicDoctors(actor, params.id, query) };
  });
}
