import { requireUser } from '@/server/session';
import { ExportHistory } from '@/components/exports/export-history';

export const dynamic = 'force-dynamic';

export default async function ExportsPage() {
  await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Exports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CSV files you requested. They are generated in the background, appear here when ready, and
          expire 24 hours after the request. Download links are short-lived.
        </p>
      </div>
      <ExportHistory />
    </div>
  );
}
