import type { NextRequest } from 'next/server';
import { AppError } from '@curenear/shared';
import { handleAuthedRequest } from '@/lib/api/handler';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';
/** The full all-India file takes a minute or two; allow the request to finish. */
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/v1/admin/master/pincodes/import (multipart/form-data)
 *
 * Fields: `file` (the India Post CSV), `dryRun` ("true" to validate only).
 * Runs the same importer as the CLI, so re-uploading the same file reports the
 * rows as unchanged instead of duplicating them.
 */
export async function POST(req: NextRequest) {
  return handleAuthedRequest(req, {}, async ({ actor, requestId, ipAddress, userAgent }) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Send the CSV as multipart/form-data');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_ERROR', 'Choose a CSV file to upload');
    }
    if (file.size === 0) {
      throw new AppError('VALIDATION_ERROR', 'The file is empty');
    }
    if (file.size > MAX_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'The file is larger than 25 MB');
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new AppError('VALIDATION_ERROR', 'Upload the directory as a .csv file');
    }

    const summary = await getServices().master.importPincodes(
      actor,
      {
        fileName: file.name,
        csvText: await file.text(),
        dryRun: form.get('dryRun') === 'true',
      },
      { requestId, ipAddress, userAgent },
    );

    return { data: summary };
  });
}
