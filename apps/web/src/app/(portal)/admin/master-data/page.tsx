import { requirePermission } from '@/server/session';
import { getServices } from '@/server/services';
import { MasterDataWorkspace } from '@/components/admin/master-data-workspace';
import type {
  CouncilDto,
  DocumentTypeDto,
  PincodeStatsDto,
  ServiceCategoryDto,
  SpecialtyDto,
  StateDto,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MasterDataPage() {
  await requirePermission('master.manage');
  const master = getServices().master;

  const [specialties, councils, serviceCategories, documentTypes, states, stats] =
    await Promise.all([
      master.listSpecialties({ includeInactive: true }),
      master.listCouncils({ includeInactive: true }),
      master.listServiceCategories({ includeInactive: true }),
      master.listDocumentTypes({ includeInactive: true }),
      master.listStates(),
      master.pincodeStats({ userId: '', role: 'ADMIN' }),
    ]);

  const specialtyRows: SpecialtyDto[] = specialties.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    systemOfMedicine: row.systemOfMedicine,
    isActive: row.isActive,
  }));

  const councilRows: CouncilDto[] = councils.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    stateId: row.stateId,
    stateName: row.stateName,
    isActive: row.isActive,
  }));

  const categoryRows: ServiceCategoryDto[] = serviceCategories.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    providerType: row.providerType,
    isActive: row.isActive,
  }));

  const documentRows: DocumentTypeDto[] = documentTypes.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    providerTypes: row.providerTypes,
    requiresExpiry: row.requiresExpiry,
    expiryReminderDays: row.expiryReminderDays,
    isActive: row.isActive,
  }));

  const stateRows: StateDto[] = states.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
  }));

  const importStats: PincodeStatsDto = {
    totalPins: stats.totalPins,
    totalDistricts: stats.totalDistricts,
    lastUpdatedAt: stats.lastUpdatedAt ? stats.lastUpdatedAt.toISOString() : null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Master data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The reference lists every form reads. Retiring a row keeps existing providers intact while
          hiding it from new selections; every change is written to the audit trail.
        </p>
      </div>

      <MasterDataWorkspace
        initialSpecialties={specialtyRows}
        initialCouncils={councilRows}
        initialServiceCategories={categoryRows}
        initialDocumentTypes={documentRows}
        states={stateRows}
        pincodeStats={importStats}
      />
    </div>
  );
}
