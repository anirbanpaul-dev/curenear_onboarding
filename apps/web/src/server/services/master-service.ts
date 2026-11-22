import {
  AppError,
  can,
  type Actor,
  type CouncilRecord,
  type CreateCouncilInput,
  type CreateDocumentTypeInput,
  type CreateServiceCategoryInput,
  type CreateSpecialtyInput,
  type DistrictRecord,
  type DocumentTypeRecord,
  type MasterListFilters,
  type PincodeImportStats,
  type PincodeRecord,
  type ServiceCategoryRecord,
  type SpecialtyRecord,
  type StateRecord,
  type UpdateCouncilInput,
  type UpdateDocumentTypeInput,
  type UpdateServiceCategoryInput,
  type UpdateSpecialtyInput,
} from '@curenear/shared';
import { PincodeCsvError, type ImportPincodesResult } from '@curenear/db';
import type { RequestContext, ServiceDeps } from './service-deps';

/**
 * Master data: the reference lists every form reads. Reads are open to any
 * signed-in account; writes additionally need `master.manage` (ADMIN).
 *
 * The PIN code directory is read-only here — it is imported from the official
 * India Post CSV (scripts/import-pincodes.ts), so a correction belongs in the
 * source file, not in the portal.
 */

function assertMasterManager(actor: Actor): void {
  if (!can({ id: actor.userId, role: actor.role }, 'master.manage')) {
    throw new AppError('FORBIDDEN', 'Only administrators can change master data');
  }
}

interface CrudSpec<
  TRecord extends { id: string; isActive: boolean },
  TCreate extends { code: string },
  TUpdate extends { code?: string },
> {
  /** Singular name used in audit reasons ("specialty"). */
  kind: string;
  list(filters?: MasterListFilters): Promise<TRecord[]>;
  findById(id: string): Promise<TRecord | null>;
  findByCode(code: string): Promise<TRecord | null>;
  create(input: TCreate & { id: string }): Promise<TRecord>;
  update(input: TUpdate & { id: string }): Promise<TRecord | null>;
  /** Retirement toggle; rows are never hard deleted. */
  setActive(input: { id: string; isActive: boolean }): Promise<TRecord | null>;
}

type MasterServiceDeps = Pick<ServiceDeps, 'repositories' | 'unitOfWork' | 'now' | 'newId'> & {
  /** Wired to the database importer; tests inject a stub. */
  importPincodesFile?: (input: {
    csvText: string;
    dryRun: boolean;
  }) => Promise<ImportPincodesResult>;
};

export interface PincodeImportSummary extends ImportPincodesResult {
  fileName: string;
  dryRun: boolean;
  stats: PincodeImportStats;
}

export function createMasterService(deps: MasterServiceDeps) {
  const { repositories, now, newId } = deps;
  const master = repositories.master;

  async function audit(input: {
    actor: Actor;
    action: 'master_data.created' | 'master_data.updated' | 'master_data.deleted';
    entityId: string;
    kind: string;
    changedFieldKeys: string[];
    ctx: RequestContext;
  }): Promise<void> {
    await repositories.audits.append({
      id: newId(),
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: 'master_data',
      entityId: input.entityId,
      requestId: input.ctx.requestId,
      changedFieldKeys: input.changedFieldKeys,
      fromStatus: null,
      toStatus: null,
      reason: `${input.kind} ${input.action.split('.').pop() ?? 'change'}`,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: now(),
    });
  }

  function crudFor<
    TRecord extends { id: string; isActive: boolean },
    TCreate extends { code: string },
    TUpdate extends { code?: string },
  >(spec: CrudSpec<TRecord, TCreate, TUpdate>) {
    async function assertCodeFree(code: string, excludeId?: string): Promise<void> {
      const existing = await spec.findByCode(code);
      if (existing && existing.id !== excludeId) {
        throw new AppError('CONFLICT', `The code "${code}" is already in use`);
      }
    }

    return {
      list(filters?: MasterListFilters): Promise<TRecord[]> {
        return spec.list(filters);
      },

      async create(actor: Actor, input: TCreate, ctx: RequestContext): Promise<TRecord> {
        assertMasterManager(actor);
        await assertCodeFree(input.code);
        const record = await spec.create({ id: newId(), ...input });
        await audit({
          actor,
          action: 'master_data.created',
          entityId: record.id,
          kind: spec.kind,
          changedFieldKeys: Object.keys(input),
          ctx,
        });
        return record;
      },

      async update(
        actor: Actor,
        id: string,
        patch: TUpdate,
        ctx: RequestContext,
      ): Promise<TRecord> {
        assertMasterManager(actor);
        const current = await spec.findById(id);
        if (!current) throw new AppError('NOT_FOUND', 'That record no longer exists');
        if (patch.code !== undefined) await assertCodeFree(patch.code, id);

        const updated = await spec.update({ id, ...patch });
        if (!updated) throw new AppError('NOT_FOUND', 'That record no longer exists');

        await audit({
          actor,
          action: 'master_data.updated',
          entityId: id,
          kind: spec.kind,
          changedFieldKeys: Object.keys(patch),
          ctx,
        });
        return updated;
      },

      /** Rows referenced by providers are retired, never deleted. */
      async deactivate(actor: Actor, id: string, ctx: RequestContext): Promise<TRecord> {
        assertMasterManager(actor);
        const current = await spec.findById(id);
        if (!current) throw new AppError('NOT_FOUND', 'That record no longer exists');

        const updated = await spec.setActive({ id, isActive: false });
        if (!updated) throw new AppError('NOT_FOUND', 'That record no longer exists');

        await audit({
          actor,
          action: 'master_data.deleted',
          entityId: id,
          kind: spec.kind,
          changedFieldKeys: ['isActive'],
          ctx,
        });
        return updated;
      },
    };
  }

  const specialties = crudFor<SpecialtyRecord, CreateSpecialtyInput, UpdateSpecialtyInput>({
    kind: 'specialty',
    list: master.specialties.list,
    findById: master.specialties.findById,
    findByCode: master.specialties.findByCode,
    create: master.specialties.create,
    update: master.specialties.update,
    setActive: master.specialties.update,
  });

  const councils = crudFor<CouncilRecord, CreateCouncilInput, UpdateCouncilInput>({
    kind: 'council',
    list: master.councils.list,
    findById: master.councils.findById,
    findByCode: master.councils.findByCode,
    create: (input) => master.councils.create({ stateId: null, ...input }),
    update: master.councils.update,
    setActive: master.councils.update,
  });

  const serviceCategories = crudFor<
    ServiceCategoryRecord,
    CreateServiceCategoryInput,
    UpdateServiceCategoryInput
  >({
    kind: 'service category',
    list: master.serviceCategories.list,
    findById: master.serviceCategories.findById,
    findByCode: master.serviceCategories.findByCode,
    create: master.serviceCategories.create,
    update: master.serviceCategories.update,
    setActive: master.serviceCategories.update,
  });

  const documentTypes = crudFor<
    DocumentTypeRecord,
    CreateDocumentTypeInput,
    UpdateDocumentTypeInput
  >({
    kind: 'document type',
    list: master.documentTypes.list,
    findById: master.documentTypes.findById,
    findByCode: master.documentTypes.findByCode,
    create: master.documentTypes.create,
    update: master.documentTypes.update,
    setActive: master.documentTypes.update,
  });

  return {
    // --- PIN code directory (read-only) ------------------------------------
    searchPincodes(_actor: Actor, q: string): Promise<PincodeRecord[]> {
      return master.pincodes.search({ q, limit: 20 });
    },

    async getPincode(_actor: Actor, pinCode: string): Promise<PincodeRecord> {
      const row = await master.pincodes.findByPin(pinCode);
      if (!row) throw new AppError('NOT_FOUND', 'That PIN code is not in the directory');
      return row;
    },

    pincodeStats(_actor: Actor): Promise<PincodeImportStats> {
      return master.pincodes.stats();
    },

    /**
     * Browser upload of the India Post CSV. Same importer as the CLI, so the
     * counts and skip reasons match; only an administrator may run it.
     */
    async importPincodes(
      actor: Actor,
      input: { fileName: string; csvText: string; dryRun: boolean },
      ctx: RequestContext,
    ): Promise<PincodeImportSummary> {
      assertMasterManager(actor);
      if (input.csvText.trim().length === 0) {
        throw new AppError('VALIDATION_ERROR', 'The file is empty');
      }
      if (!deps.importPincodesFile) {
        throw new AppError('SERVICE_UNAVAILABLE', 'PIN code import is not configured');
      }

      let result: ImportPincodesResult;
      try {
        result = await deps.importPincodesFile({
          csvText: input.csvText,
          dryRun: input.dryRun,
        });
      } catch (error) {
        // Only a bad file is the uploader's problem; anything else (a database
        // outage, for example) must surface as a server error.
        if (error instanceof PincodeCsvError) {
          throw new AppError('VALIDATION_ERROR', error.message);
        }
        throw error;
      }

      if (!input.dryRun) {
        await repositories.audits.append({
          id: newId(),
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'master_data.imported',
          entityType: 'master_data',
          entityId: 'pin_codes',
          requestId: ctx.requestId,
          changedFieldKeys: [],
          fromStatus: null,
          toStatus: null,
          // The source file is part of the trail: it identifies which release
          // of the directory was imported.
          reason: `PIN code import from ${input.fileName}: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          createdAt: now(),
        });
      }

      return {
        ...result,
        fileName: input.fileName,
        dryRun: input.dryRun,
        stats: await master.pincodes.stats(),
      };
    },

    // --- Reference lists (any signed-in account) ---------------------------
    listStates(): Promise<StateRecord[]> {
      return master.states.list();
    },

    listDistricts(stateId?: string): Promise<DistrictRecord[]> {
      return master.districts.list(stateId);
    },

    listSpecialties(filters?: MasterListFilters): Promise<SpecialtyRecord[]> {
      return specialties.list(filters);
    },

    listCouncils(filters?: MasterListFilters): Promise<CouncilRecord[]> {
      return councils.list(filters);
    },

    listServiceCategories(filters?: MasterListFilters): Promise<ServiceCategoryRecord[]> {
      return serviceCategories.list(filters);
    },

    listDocumentTypes(filters?: MasterListFilters): Promise<DocumentTypeRecord[]> {
      return documentTypes.list(filters);
    },

    // --- Editable lists (ADMIN) --------------------------------------------
    createSpecialty: specialties.create,
    updateSpecialty: specialties.update,
    deactivateSpecialty: specialties.deactivate,

    createCouncil: councils.create,
    updateCouncil: councils.update,
    deactivateCouncil: councils.deactivate,

    createServiceCategory: serviceCategories.create,
    updateServiceCategory: serviceCategories.update,
    deactivateServiceCategory: serviceCategories.deactivate,

    createDocumentType: documentTypes.create,
    updateDocumentType: documentTypes.update,
    deactivateDocumentType: documentTypes.deactivate,
  };
}

export type MasterService = ReturnType<typeof createMasterService>;
