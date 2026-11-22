import type { NextRequest } from 'next/server';
import { insuranceInputSchema, providerIdParamsSchema } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/http';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse(params);
    return { data: await getServices().onboarding.listInsurance(actor, params.id) };
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleAuthedRequest(req, { id }, async ({ actor, params }) => {
    providerIdParamsSchema.parse(params);
    const input = await parseBody(req, insuranceInputSchema);
    return {
      data: await getServices().onboarding.createInsurance(actor, params.id, input),
      status: 201,
    };
  });
}
