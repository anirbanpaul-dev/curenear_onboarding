import {
  AppError,
  assessCompleteness,
  can,
  pageMeta,
  type Actor,
  type AdminProviderDirectoryRow,
  type AdminProviderFacets,
  type AdminProviderFilters,
  type AdminProviderListQuery,
  type AuditEntry,
  type ProviderDirectoryViewInput,
  type ProviderDirectoryViewRecord,
  type ProviderStatusHistoryRecord,
  type StaffMemberRecord,
} from '@curenear/shared';
import type { OrganizationDetail } from './provider-onboarding-service';
import type { ServiceDeps } from './service-deps';

/**
 * The admin provider directory.
 *
 * Authorization is `provider.read.all`: administrators have it, staff do not.
 * Staff keep using the owner-scoped onboarding service, so nothing here can be
 * reached with a staff session.
 */

function startOfDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayAfter(value: string): Date {
  return new Date(startOfDay(value).getTime() + 24 * 60 * 60 * 1000);
}

function assertDirectoryReader(actor: Actor): void {
  if (!can({ id: actor.userId, role: actor.role }, 'provider.read.all')) {
    throw new AppError('FORBIDDEN', 'Only administrators can use the provider directory');
  }
}

export function toAdminProviderFilters(query: AdminProviderListQuery): AdminProviderFilters {
  return {
    providerTypes: query.providerType ?? [],
    statuses: query.status ?? [],
    pins: query.pin ?? [],
    stateId: query.state ?? null,
    districtId: query.district ?? null,
    onboardedByUserId: query.onboardedBy ?? null,
    createdFrom: query.createdFrom ? startOfDay(query.createdFrom) : null,
    createdBefore: query.createdTo ? dayAfter(query.createdTo) : null,
    submittedFrom: query.submittedFrom ? startOfDay(query.submittedFrom) : null,
    submittedBefore: query.submittedTo ? dayAfter(query.submittedTo) : null,
    licenceExpiringDays: query.licenceExpiringDays ?? null,
    missingDocuments: query.missingDocuments ?? null,
    search: query.q && query.q.length > 0 ? query.q : null,
  };
}

export interface AdminProviderListResult {
  rows: AdminProviderDirectoryRow[];
  facets: AdminProviderFacets;
  meta: ReturnType<typeof pageMeta>;
}

export interface AdminProviderDetail {
  detail: OrganizationDetail;
  statusHistory: ProviderStatusHistoryRecord[];
  audit: AuditEntry[];
  staff: StaffMemberRecord | null;
}

export function createAdminDirectoryService(
  deps: Pick<ServiceDeps, 'repositories' | 'unitOfWork' | 'now' | 'newId'>,
) {
  const { repositories, newId } = deps;

  /**
   * The detail page needs the whole snapshot (locations, licences, documents,
   * contacts) plus completeness. It lives here rather than in the page so the
   * service and the server component return the same shape.
   */
  async function loadDetail(id: string): Promise<OrganizationDetail> {
    const [organization, locations, contacts, licences, insurance, servicePins, documents] =
      await Promise.all([
        repositories.onboarding.findOrganizationById(id),
        repositories.onboarding.listLocations(id),
        repositories.onboarding.listContacts(id),
        repositories.onboarding.listLicences(id),
        repositories.onboarding.listInsurance(id),
        repositories.onboarding.listServicePins(id),
        repositories.onboarding.listDocuments(id),
      ]);
    if (!organization) throw new AppError('NOT_FOUND', 'Provider not found');

    const doctorProfile =
      organization.providerType === 'doctor'
        ? await repositories.onboarding.findDoctorProfileByOrganizationId(id)
        : null;
    const doctorPractices = doctorProfile
      ? await repositories.onboarding.listDoctorPractices(doctorProfile.id)
      : [];
    const clinicDoctors =
      organization.providerType === 'clinic'
        ? await repositories.onboarding.listClinicDoctorLinks(id)
        : [];

    const snapshot = {
      organization,
      locations,
      contacts,
      licences,
      insurance,
      servicePins,
      documents,
      doctorProfile,
      doctorPractices,
      clinicDoctors,
    };
    return { ...snapshot, completeness: assessCompleteness(organization.providerType, snapshot) };
  }

  return {
    async list(actor: Actor, query: AdminProviderListQuery): Promise<AdminProviderListResult> {
      assertDirectoryReader(actor);
      const filters = toAdminProviderFilters(query);
      const [result, facets] = await Promise.all([
        repositories.directory.search(
          filters,
          { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
          { field: query.sort, order: query.order },
        ),
        repositories.directory.facets(filters),
      ]);

      return {
        rows: result.rows,
        facets,
        meta: pageMeta({
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          sort: query.sort,
          order: query.order,
        }),
      };
    },

    async get(actor: Actor, id: string): Promise<AdminProviderDetail> {
      assertDirectoryReader(actor);
      const detail = await loadDetail(id);
      const [statusHistory, audit, staff] = await Promise.all([
        repositories.onboarding.listStatusHistory(id, 100),
        repositories.audits.listForEntity('provider_organization', id, 100),
        repositories.staff.findById(detail.organization.createdByUserId, { includeDeleted: true }),
      ]);
      return { detail, statusHistory, audit, staff };
    },

    async views(actor: Actor): Promise<ProviderDirectoryViewRecord[]> {
      assertDirectoryReader(actor);
      return repositories.directory.listViews(actor.userId);
    },

    async saveView(
      actor: Actor,
      input: ProviderDirectoryViewInput,
    ): Promise<ProviderDirectoryViewRecord> {
      assertDirectoryReader(actor);
      return repositories.directory.saveView({
        id: newId(),
        userId: actor.userId,
        name: input.name,
        query: input.query,
      });
    },

    async deleteView(actor: Actor, id: string): Promise<{ deleted: true }> {
      assertDirectoryReader(actor);
      const deleted = await repositories.directory.deleteView(actor.userId, id);
      if (!deleted) throw new AppError('NOT_FOUND', 'Saved view not found');
      return { deleted: true };
    },
  };
}

export type AdminDirectoryService = ReturnType<typeof createAdminDirectoryService>;
