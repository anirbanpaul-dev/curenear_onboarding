import { requirePermission } from '@/server/session';
import { ProviderDirectory } from '@/components/admin/provider-directory';
import { ExportButton } from '@/components/exports/export-button';

export const dynamic = 'force-dynamic';

export default async function AdminProvidersPage() {
  await requirePermission('provider.read.all');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Provider directory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every provider across all staff members. Filters live in the URL, so a view can be
            shared or saved. Exports run in the background and match the current filters.
          </p>
        </div>
        <ExportButton type="providers" label="Export filtered providers" />
      </div>
      <ProviderDirectory />
    </div>
  );
}
