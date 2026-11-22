import { createHash } from 'node:crypto';
import {
  AppError,
  adminOnlyFieldsFor,
  assessCompleteness,
  assertEventPayloadIsSafe,
  formSectionsFor,
  importTestCatalogueCsv,
  parseRepeaterItem,
  sectionsForProvider,
  stripAdminOnlyTypeData,
  testCatalogueTemplateCsv,
  typeDataDefaultsFor,
  validateAdminTypeDataSection,
  assertOrganizationTransition,
  collectTypeDataIssues,
  consentGaps,
  doctorVerificationItems,
  isOwnerEditableStatus,
  requiredVerificationItemsFor,
  verificationItemsForSection,
  outboxEventVersions,
  organizationEventPayloadSchema,
  validateProviderSection,
  validateTypeDataSection,
  type Actor,
  type AdminSwitchesInput,
  type ClinicDoctorCreateInput,
  type ClinicDoctorLinkRecord,
  type ClinicDoctorSearchInput,
  type ClinicDoctorUpdateInput,
  type CompletenessReport,
  type ContactInput,
  type CreateOrganizationInput,
  type DoctorLocationRecord,
  type DoctorPracticeInput,
  type DoctorPracticeUpdateInput,
  type DoctorProfileRecord,
  type DoctorProfileSaveInput,
  type DocumentInput,
  type DuplicateCheck,
  type HighRiskStatusInput,
  type TestCatalogueImportPayload,
  type TestCatalogueImportReport,
  type DuplicateMatch,
  type InsuranceInput,
  type InsuranceUpdateInput,
  type LicenceInput,
  type LicenceUpdateInput,
  type LocationInput,
  type LocationUpdateInput,
  type OrganizationStatus,
  type ProviderContactRecord,
  type ProviderDocumentRecord,
  type ProviderInsuranceRecord,
  type ProviderLicenceRecord,
  type ProviderLocationRecord,
  type ProviderOrganizationRecord,
  type ProviderServicePinRecord,
  type ProviderSnapshot,
  type ProviderType,
  type Repositories,
  type ReviewCommentDto,
  type SectionSaveInput,
  type SuspensionScope,
  type ServicePinInput,
  type SubmitOrganizationInput,
  type TransitionOrganizationInput,
} from '@curenear/shared';
import type {
  OnboardingDocumentInput,
  OnboardingInsuranceInput,
  OnboardingInsurancePatch,
  OnboardingLicenceInput,
  OnboardingLicencePatch,
  OnboardingLocationInput,
  OnboardingLocationPatch,
} from '@curenear/shared';
import type { RequestContext, ServiceDeps } from './service-deps';

/** The API speaks snake_case; the repository ports speak camelCase. */
function compact<T extends object>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function dateOrNull(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

function toLocation(input: LocationUpdateInput & { name?: string }): OnboardingLocationPatch {
  return compact({
    name: input.name,
    locationType: input.location_type,
    addressLine1: input.address_line1,
    addressLine2: input.address_line2,
    landmark: input.landmark,
    city: input.city,
    districtId: input.district_id,
    stateId: input.state_id,
    pinCode: input.pin_code,
    latitude: input.latitude,
    longitude: input.longitude,
    isPrimary: input.is_primary,
    isPublic: input.is_public,
    operatingHours: input.operating_hours,
    bookingPhone: input.booking_phone,
    branchRef: input.branch_ref,
  });
}

function toLicence(input: LicenceUpdateInput): OnboardingLicencePatch {
  return compact({
    licenceTypeId: input.licence_type_id,
    locationId: input.location_id,
    number: input.number,
    authority: input.authority,
    issuedOn: input.issued_on === undefined ? undefined : dateOrNull(input.issued_on),
    validFrom: input.valid_from === undefined ? undefined : dateOrNull(input.valid_from),
    validTo: input.valid_to === undefined ? undefined : dateOrNull(input.valid_to),
    status: input.status,
    documentId: input.document_id,
    details: input.details,
  });
}

function toInsurance(input: InsuranceUpdateInput): OnboardingInsurancePatch {
  return compact({
    type: input.type,
    insurer: input.insurer,
    policyNo: input.policy_no,
    limitPaise: input.limit_paise,
    validFrom: input.valid_from === undefined ? undefined : dateOrNull(input.valid_from),
    validTo: input.valid_to === undefined ? undefined : dateOrNull(input.valid_to),
    documentId: input.document_id,
  });
}

function toDocument(input: DocumentInput): OnboardingDocumentInput {
  return {
    fileName: input.file_name,
    mimeType: input.mime_type,
    sizeBytes: input.size_bytes,
    storageKey: input.storage_key ?? null,
    role: input.role,
    uploadedByUserId: '',
  };
}

/**
 * Provider onboarding: drafts, section autosave, completeness, duplicate
 * detection and the review lifecycle.
 *
 * Layering: routes call this service, the service calls repositories (inside one
 * `unitOfWork.transaction` per write) and never touches Prisma. Every lifecycle
 * transition writes status history, an audit row and an outbox event in the
 * same transaction as the status change.
 */

const listLimit = 100;

export interface OrganizationDetail {
  organization: ProviderOrganizationRecord;
  locations: ProviderLocationRecord[];
  contacts: ProviderContactRecord[];
  licences: ProviderLicenceRecord[];
  insurance: ProviderInsuranceRecord[];
  servicePins: ProviderServicePinRecord[];
  documents: ProviderDocumentRecord[];
  doctorProfile?: DoctorProfileRecord | null;
  doctorPractices?: DoctorLocationRecord[];
  clinicDoctors?: ClinicDoctorLinkRecord[];
  completeness: CompletenessReport;
  /** Latest comment on a CHANGES_REQUESTED decision; the only review note staff see. */
  changeRequest?: { comment: string; at: Date } | null;
  /** Per-section reviewer notes shown to the onboarding staff. */
  reviewComments?: ReviewCommentDto[];
}

function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object') cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] ?? path] = value;
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface IdentityFields {
  registrationNumber: string | null;
  mobile: string | null;
  legalName: string | null;
  doctorRegistrationNo: string | null;
}

const normalizeIdentity = (value: string | null): string => (value ?? '').trim().toLowerCase();

/**
 * Which duplicate-relevant fields a save actually changed. Autosave runs a lot,
 * so duplicate detection is limited to the fields it compares on.
 */
export function identityChanges(before: IdentityFields, after: IdentityFields) {
  const changed = (a: string | null, b: string | null) =>
    normalizeIdentity(a) !== normalizeIdentity(b);
  const registration = changed(before.registrationNumber, after.registrationNumber);
  const mobile = changed(before.mobile, after.mobile);
  const name = changed(before.legalName, after.legalName);
  const doctorRegistration = changed(before.doctorRegistrationNo, after.doctorRegistrationNo);
  return {
    registration,
    mobile,
    name,
    doctorRegistration,
    any: registration || mobile || name || doctorRegistration,
  };
}

const columnFor = {
  legal_name: 'legalName',
  trade_name: 'tradeName',
  constitution_type: 'constitutionType',
  registration_number: 'registrationNumber',
  established_on: 'establishedOn',
  website: 'website',
  email: 'email',
  mobile: 'mobile',
} as const;

export function createProviderOnboardingService(deps: ServiceDeps) {
  const { unitOfWork, now, newId, repositories } = deps;

  function notFound(): never {
    // Staff who do not own a provider get 404, never 403: the record's existence
    // is not theirs to learn.
    throw new AppError('NOT_FOUND', 'Provider not found');
  }

  function assertAccess(actor: Actor, organization: ProviderOrganizationRecord): void {
    // Read and write share one rule: staff only see their own drafts, admins see
    // everything. Anything else is a 404, never a 403.
    if (actor.role === 'ADMIN') return;
    if (organization.createdByUserId !== actor.userId) notFound();
    if (!isOwnerEditableStatus(organization.status)) notFound();
  }

  async function load(actor: Actor, id: string): Promise<ProviderOrganizationRecord> {
    const organization = await repositories.onboarding.findOrganizationById(id);
    if (!organization) notFound();
    assertAccess(actor, organization);
    return organization;
  }

  async function snapshot(repos: Repositories, organizationId: string): Promise<ProviderSnapshot> {
    const [organization, locations, contacts, licences, insurance, servicePins, documents] =
      await Promise.all([
        repos.onboarding.findOrganizationById(organizationId),
        repos.onboarding.listLocations(organizationId),
        repos.onboarding.listContacts(organizationId),
        repos.onboarding.listLicences(organizationId),
        repos.onboarding.listInsurance(organizationId),
        repos.onboarding.listServicePins(organizationId),
        repos.onboarding.listDocuments(organizationId),
      ]);
    if (!organization) notFound();
    const doctorProfile =
      organization.providerType === 'doctor'
        ? await repos.onboarding.findDoctorProfileByOrganizationId(organizationId)
        : null;
    const doctorPractices = doctorProfile
      ? await repos.onboarding.listDoctorPractices(doctorProfile.id)
      : [];
    const clinicDoctors =
      organization.providerType === 'clinic'
        ? await repos.onboarding.listClinicDoctorLinks(organizationId)
        : [];
    return {
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
  }

  async function resolveCouncilId(repos: Repositories, name: string): Promise<string | null> {
    const councils = await repos.master.councils.list({ includeInactive: true });
    const needle = name.trim().toLowerCase();
    return (
      councils.find((row) => row.name.toLowerCase() === needle || row.code.toLowerCase() === needle)
        ?.id ?? null
    );
  }

  async function resolveSpecialtyId(repos: Repositories, name: string): Promise<string | null> {
    const specialties = await repos.master.specialties.list({ includeInactive: true });
    const needle = name.trim().toLowerCase();
    return (
      specialties.find(
        (row) => row.name.toLowerCase() === needle || row.code.toLowerCase() === needle,
      )?.id ?? null
    );
  }

  async function withSnapshot(organizationId: string): Promise<{
    snapshot: ProviderSnapshot;
    completeness: CompletenessReport;
  }> {
    const value = await snapshot(repositories, organizationId);
    return {
      snapshot: value,
      completeness: assessCompleteness(value.organization.providerType, value),
    };
  }

  function match(
    kind: DuplicateMatch['kind'],
    row: { id: string; code: string; legalName: string | null; status: OrganizationStatus },
    message: string,
    hardBlock: boolean,
    similarity?: number,
    redact = false,
  ): DuplicateMatch {
    return {
      kind,
      providerId: redact ? '' : row.id,
      providerCode: redact ? '' : row.code,
      providerName: redact ? null : row.legalName,
      status: row.status,
      hardBlock,
      message,
      link: redact ? '' : `/admin/providers/${row.id}`,
      ...(similarity === undefined ? {} : { similarity }),
    };
  }

  /**
   * Duplicate detection shared by create, section save and licence writes.
   * Exact licence numbers and exact doctor registrations block; the rest warn.
   */
  /**
   * Admin-only `type_data` (online-sale switches, high-risk flags) is removed
   * before a staff response leaves the service.
   */
  function visibleOrganization(
    organization: ProviderOrganizationRecord,
    actor: Actor,
  ): ProviderOrganizationRecord {
    if (actor.role === 'ADMIN') return organization;
    return {
      ...organization,
      typeData: stripAdminOnlyTypeData(organization.providerType, organization.typeData),
    };
  }

  /** Duplicate checks and match links follow the caller's area. */
  function scope(actor: Actor): { ownerUserId: string | null; linkBase: string } {
    return actor.role === 'ADMIN'
      ? { ownerUserId: null, linkBase: '/admin' }
      : { ownerUserId: actor.userId, linkBase: '/staff' };
  }

  async function duplicates(
    repos: Repositories,
    input: {
      organizationId: string | null;
      /** Staff scope: only this user's providers may appear as matches. */
      ownerUserId?: string | null;
      /** Admin or staff detail page the match links to. */
      linkBase?: string;
      registrationNumber?: string | null;
      licenceNumber?: string | null;
      mobile?: string | null;
      pinCode?: string | null;
      legalName?: string | null;
      doctorRegistrationNo?: string | null;
    },
  ): Promise<DuplicateCheck> {
    const exclude = input.organizationId;
    const found: DuplicateMatch[] = [];

    /**
     * Duplicate protection spans the whole register, but a staff member must
     * not learn whose provider matched. Foreign matches keep their kind and
     * message and lose the id, code, name and link.
     */
    const redacted = (row: { createdByUserId?: string }): boolean =>
      Boolean(input.ownerUserId) && row.createdByUserId !== input.ownerUserId;

    if (input.registrationNumber) {
      const rows = await repos.onboarding.findByRegistrationNumber(
        input.registrationNumber,
        exclude,
      );
      for (const row of rows) {
        found.push(
          match(
            'registration_number',
            row,
            'Another provider is registered with this registration number',
            false,
            undefined,
            redacted(row),
          ),
        );
      }
    }

    if (input.licenceNumber) {
      const rows = await repos.onboarding.findByLicenceNumber(input.licenceNumber, exclude);
      for (const row of rows) {
        found.push(
          match(
            'licence_number',
            row,
            'This licence number is already registered',
            true,
            undefined,
            redacted(row),
          ),
        );
      }
    }

    if (input.mobile && input.pinCode) {
      const rows = await repos.onboarding.findByMobileAndPin(input.mobile, input.pinCode, exclude);
      for (const row of rows) {
        found.push(
          match(
            'mobile_pin',
            row,
            'A provider with this mobile number already covers this PIN code',
            false,
            undefined,
            redacted(row),
          ),
        );
      }
    }

    if (input.legalName && input.pinCode) {
      const rows = await repos.onboarding.findSimilarLegalName(
        input.legalName,
        input.pinCode,
        exclude,
        input.ownerUserId ?? null,
      );
      for (const row of rows) {
        found.push(
          match(
            'legal_name_similar',
            row,
            `Similar provider name in the same PIN code (${Math.round((row.similarity ?? 0) * 100)}% match)`,
            false,
            row.similarity,
            redacted(row),
          ),
        );
      }
    }

    if (input.doctorRegistrationNo) {
      const rows = await repos.onboarding.findDoctorRegistration(input.doctorRegistrationNo, null);
      for (const row of rows) {
        if (exclude && row.organizationId === exclude) continue;
        const organization = row.organizationId
          ? await repos.onboarding.findOrganizationById(row.organizationId, {
              includeDeleted: true,
            })
          : null;
        found.push(
          match(
            'doctor_registration',
            {
              id: organization?.id ?? row.id,
              code: organization?.code ?? 'doctor',
              legalName: organization?.legalName ?? null,
              status: organization?.status ?? 'DRAFT',
              ...(organization?.createdByUserId
                ? { createdByUserId: organization.createdByUserId }
                : {}),
            },
            'A doctor with this registration number is already registered',
            true,
            undefined,
            input.ownerUserId ? organization?.createdByUserId !== input.ownerUserId : false,
          ),
        );
      }
    }

    const prefix = input.linkBase ?? '/admin';
    // A redacted match has no id to link to; keep the field empty rather than
    // producing `/staff/providers/`.
    const relink = (rows: DuplicateMatch[]): DuplicateMatch[] =>
      rows.map((row) => ({
        ...row,
        link: row.providerId ? `${prefix}/providers/${row.providerId}` : '',
      }));

    if (exclude) {
      const dismissed = new Set(await repos.onboarding.listDismissedDuplicateIds(exclude));
      return {
        warnings: relink(found.filter((row) => !row.hardBlock && !dismissed.has(row.providerId))),
        blocked: relink(found.filter((row) => row.hardBlock)),
      };
    }
    return {
      warnings: relink(found.filter((row) => !row.hardBlock)),
      blocked: relink(found.filter((row) => row.hardBlock)),
    };
  }

  function throwBlocked(check: DuplicateCheck): void {
    if (check.blocked.length === 0) return;
    throw new AppError('CONFLICT', check.blocked[0]?.message ?? 'Duplicate provider', {
      duplicates: check.blocked,
    });
  }

  function audit(
    repos: Repositories,
    input: {
      actor: Actor;
      action: string;
      entityId: string;
      ctx: RequestContext;
      changedFieldKeys?: string[];
      reason?: string | null;
      occurredAt: Date;
    },
  ): Promise<void> {
    return repos.audits.append({
      id: newId(),
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: 'provider_organization',
      entityId: input.entityId,
      requestId: input.ctx.requestId,
      changedFieldKeys: input.changedFieldKeys ?? [],
      fromStatus: null,
      toStatus: null,
      reason: input.reason ?? null,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: input.occurredAt,
    });
  }

  async function transition(
    repos: Repositories,
    organization: ProviderOrganizationRecord,
    to: OrganizationStatus,
    actor: Actor,
    ctx: RequestContext,
    options: {
      version?: number;
      reason?: string | null;
      validationPassed: boolean;
      scope?: SuspensionScope | null;
      scopeRefId?: string | null;
      scopeLabel?: string | null;
      flaggedSections?: string[];
    },
  ): Promise<ProviderOrganizationRecord> {
    // A clinic-added doctor must personally confirm before the clinic is
    // approved (field spec 6.5).
    if (to === 'APPROVED' && organization.providerType === 'clinic') {
      const [links, consents] = await Promise.all([
        repos.onboarding.listClinicDoctorLinks(organization.id),
        repos.consents.listByOrganization(organization.id),
      ]);
      const unconfirmed = links.filter(
        (link) =>
          link.doctor.createdByOrgId === organization.id &&
          !consents.some(
            (consent) =>
              consent.consentType === 'doctor_confirmation' &&
              !consent.revokedAt &&
              consent.doctorProfileId === link.doctor.id,
          ),
      );
      if (unconfirmed.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Every clinic-added doctor must confirm their declaration and publication consent before approval',
          { doctors: unconfirmed.map((link) => link.doctor.id) },
        );
      }
    }

    const rule = assertOrganizationTransition({
      from: organization.status,
      to,
      actor,
      ownerUserId: organization.createdByUserId,
      reason: options.reason ?? null,
      validationPassed: options.validationPassed,
    });

    const occurredAt = now();
    const updated = await repos.onboarding.transitionOrganization({
      id: organization.id,
      expectedVersion: options.version ?? organization.version,
      fromStatus: organization.status,
      toStatus: to,
      changedByUserId: actor.userId,
      reason: options.reason?.trim() || null,
      ...(to === 'SUBMITTED' ? { submittedAt: occurredAt } : {}),
      ...(to === 'APPROVED' ? { approvedAt: occurredAt, approvedByUserId: actor.userId } : {}),
      ...(to === 'REJECTED' ? { approvedAt: null, approvedByUserId: null } : {}),
    });

    if (!updated) {
      throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
        expectedVersion: options.version ?? organization.version,
      });
    }

    await repos.onboarding.appendStatusHistory({
      id: newId(),
      organizationId: updated.id,
      fromStatus: organization.status,
      toStatus: to,
      changedByUserId: actor.userId,
      reason: options.reason?.trim() || null,
      scope: options.scope ?? null,
      scopeRefId: options.scopeRefId ?? null,
      scopeLabel: options.scopeLabel ?? null,
      flaggedSections: options.flaggedSections ?? [],
      at: occurredAt,
    });

    await audit(repos, {
      actor,
      action: rule.action,
      entityId: updated.id,
      ctx,
      reason: options.reason?.trim() || null,
      occurredAt,
    });

    const payload = organizationEventPayloadSchema.parse({
      organizationId: updated.id,
      providerType: updated.providerType,
      status: to,
      recordVersion: updated.version,
      actorUserId: actor.userId,
      ...(options.reason?.trim() ? { reason: options.reason.trim() } : {}),
    });
    assertEventPayloadIsSafe(payload as Record<string, unknown>);

    await repos.outbox.append({
      id: newId(),
      eventType: rule.event,
      eventVersion: outboxEventVersions[rule.event],
      aggregateType: 'provider_organization',
      aggregateId: updated.id,
      payload: payload as Record<string, unknown>,
      occurredAt,
      dedupeKey: `${updated.id}:${rule.event}:${updated.version}`,
    });

    return visibleOrganization(updated, actor);
  }

  /**
   * After a change request, editing a section invalidates the checks that
   * depend on it. Items that were never checked stay PENDING, which they
   * already are; only settled items are reset.
   */
  async function resetChangedVerifications(
    repos: Repositories,
    organization: { id: string; status: OrganizationStatus },
    items: string[],
  ): Promise<void> {
    if (organization.status !== 'CHANGES_REQUESTED' || items.length === 0) return;
    await repos.reviews.resetItems(organization.id, items);
  }

  return {
    async create(
      actor: Actor,
      input: CreateOrganizationInput,
      ctx: RequestContext,
      idempotencyKey?: string,
    ): Promise<{
      provider: ProviderOrganizationRecord;
      warnings: DuplicateMatch[];
      replayed: boolean;
    }> {
      const endpoint = 'POST /api/v1/providers';
      const requestHash = hashRequest(input);

      return unitOfWork.transaction(async (repos) => {
        if (idempotencyKey) {
          const existing = await repos.idempotency.find({
            userId: actor.userId,
            endpoint,
            key: idempotencyKey,
          });
          if (existing) {
            if (existing.requestHash !== requestHash) {
              throw new AppError(
                'IDEMPOTENCY_MISMATCH',
                'This idempotency key was already used with different data',
              );
            }
            const organizationId = existing.response.organizationId;
            const replay =
              typeof organizationId === 'string'
                ? await repos.onboarding.findOrganizationById(organizationId, {
                    includeDeleted: true,
                  })
                : null;
            if (replay) {
              return {
                provider: visibleOrganization(replay, actor),
                warnings: [],
                replayed: true,
              };
            }
          }
        }

        const check = await duplicates(repos, {
          organizationId: null,
          registrationNumber: input.registration_number ?? null,
          mobile: input.mobile ?? null,
          pinCode: input.primary_pin_code ?? null,
          legalName: input.legal_name,
          ...scope(actor),
        });
        throwBlocked(check);

        const organization = await repos.onboarding.createOrganization({
          id: newId(),
          providerType: input.provider_type,
          legalName: input.legal_name,
          tradeName: input.trade_name ?? null,
          registrationNumber: input.registration_number ?? null,
          website: input.website ?? null,
          email: input.email ?? null,
          mobile: input.mobile ?? null,
          primaryPinCode: input.primary_pin_code ?? null,
          // Registry-owned defaults: the pharmacy online-sale switches start off.
          typeData: typeDataDefaultsFor(input.provider_type),
          createdByUserId: actor.userId,
        });

        if (idempotencyKey) {
          await repos.idempotency.save({
            userId: actor.userId,
            endpoint,
            key: idempotencyKey,
            requestHash,
            response: { organizationId: organization.id },
          });
        }

        const occurredAt = now();
        await audit(repos, {
          actor,
          action: 'provider.created',
          entityId: organization.id,
          ctx,
          changedFieldKeys: Object.keys(input).sort(),
          occurredAt,
        });

        const payload = organizationEventPayloadSchema.parse({
          organizationId: organization.id,
          providerType: organization.providerType,
          status: organization.status,
          recordVersion: organization.version,
          actorUserId: actor.userId,
        });
        await repos.outbox.append({
          id: newId(),
          eventType: 'provider.created',
          eventVersion: outboxEventVersions['provider.created'],
          aggregateType: 'provider_organization',
          aggregateId: organization.id,
          payload: payload as Record<string, unknown>,
          occurredAt,
          dedupeKey: `${organization.id}:provider.created:${organization.version}`,
        });

        return {
          provider: visibleOrganization(organization, actor),
          warnings: check.warnings,
          replayed: false,
        };
      });
    },

    async list(actor: Actor): Promise<ProviderOrganizationRecord[]> {
      const rows = await repositories.onboarding.listOrganizations(
        actor.role === 'ADMIN' ? {} : { createdByUserId: actor.userId },
      );
      return rows.map((row) => visibleOrganization(row, actor));
    },

    /** Duplicate warnings for the start page, before any draft exists. */
    async previewDuplicates(
      actor: Actor,
      input: { legal_name: string; mobile?: string; pin_code?: string },
    ): Promise<DuplicateCheck> {
      return duplicates(repositories, {
        organizationId: null,
        legalName: input.legal_name,
        mobile: input.mobile ?? null,
        pinCode: input.pin_code ?? null,
        ...scope(actor),
      });
    },

    async get(actor: Actor, id: string): Promise<OrganizationDetail> {
      await load(actor, id);
      const [{ snapshot: value, completeness }, history] = await Promise.all([
        withSnapshot(id),
        repositories.onboarding.listStatusHistory(id, 50),
      ]);
      // Only the change-request comment is addressed to the provider; every
      // other review note stays in the admin area.
      const returned = history.find(
        (entry) => entry.toStatus === 'CHANGES_REQUESTED' && entry.reason?.trim(),
      );
      const reviewComments = await repositories.reviews.comments(id);
      return {
        ...value,
        organization: visibleOrganization(value.organization, actor),
        completeness,
        changeRequest: returned
          ? { comment: (returned.reason as string).trim(), at: returned.at }
          : null,
        reviewComments,
      };
    },

    async completeness(actor: Actor, id: string): Promise<CompletenessReport> {
      await load(actor, id);
      return (await withSnapshot(id)).completeness;
    },

    async saveSection(
      actor: Actor,
      id: string,
      sectionKey: string,
      input: SectionSaveInput,
      ctx: RequestContext,
    ): Promise<{
      provider: ProviderOrganizationRecord;
      completeness: CompletenessReport;
      warnings: DuplicateMatch[];
    }> {
      const organization = await load(actor, id);
      // Admin-controlled switches never travel through the provider form.
      const adminKeys = new Set(
        adminOnlyFieldsFor(organization.providerType).map((field) => field.key),
      );
      const adminKey = Object.keys(input.data).find((key) => adminKeys.has(key));
      if (adminKey) {
        throw new AppError('FORBIDDEN', `${adminKey} can only be changed by an administrator`);
      }
      const values = validateProviderSection(organization.providerType, sectionKey, input.data);

      const columns: Record<string, unknown> = {};
      const profileData = { ...organization.profileData };
      const publicationConsents = { ...organization.publicationConsents };
      let touchedProfile = false;
      let touchedConsents = false;

      for (const [path, value] of Object.entries(values.columns)) {
        if (path.startsWith('profile_data.')) {
          setNested(profileData, path.slice('profile_data.'.length), value);
          touchedProfile = true;
          continue;
        }
        if (path.startsWith('publication_consents.')) {
          setNested(publicationConsents, path.slice('publication_consents.'.length), value);
          touchedConsents = true;
          continue;
        }
        const column = path.startsWith('provider_organizations.')
          ? path.slice('provider_organizations.'.length)
          : path;
        const field = columnFor[column as keyof typeof columnFor];
        if (!field) continue;
        columns[field] =
          field === 'establishedOn' && typeof value === 'string' ? new Date(value) : value;
      }

      const nextTypeData = { ...organization.typeData, ...values.typeData };
      const nextRegistration =
        (columns.registrationNumber as string | undefined) ?? organization.registrationNumber;
      const nextLegalName = (columns.legalName as string | undefined) ?? organization.legalName;
      const nextMobile = (columns.mobile as string | undefined) ?? organization.mobile;
      const nextDoctorRegistration =
        typeof nextTypeData.doc_reg_no === 'string' ? nextTypeData.doc_reg_no : null;

      const changes = identityChanges(
        {
          registrationNumber: organization.registrationNumber,
          mobile: organization.mobile,
          legalName: organization.legalName,
          doctorRegistrationNo:
            typeof organization.typeData.doc_reg_no === 'string'
              ? organization.typeData.doc_reg_no
              : null,
        },
        {
          registrationNumber: nextRegistration,
          mobile: nextMobile,
          legalName: nextLegalName,
          doctorRegistrationNo: nextDoctorRegistration,
        },
      );

      return unitOfWork.transaction(async (repos) => {
        let check: DuplicateCheck = { warnings: [], blocked: [] };
        if (changes.any) {
          check = await duplicates(repos, {
            organizationId: id,
            ...scope(actor),
            registrationNumber: changes.registration ? nextRegistration : null,
            mobile: changes.mobile ? nextMobile : null,
            legalName: changes.name ? nextLegalName : null,
            pinCode: organization.primaryPinCode,
            doctorRegistrationNo: changes.doctorRegistration ? nextDoctorRegistration : null,
          });
          throwBlocked(check);
        }

        const updated = await repos.onboarding.updateOrganization({
          id,
          expectedVersion: input.version,
          columns,
          typeData: nextTypeData,
          ...(touchedProfile ? { profileData } : {}),
          ...(touchedConsents ? { publicationConsents } : {}),
        });
        if (!updated) {
          throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
            expectedVersion: input.version,
          });
        }

        await audit(repos, {
          actor,
          action: 'provider.section.saved',
          entityId: id,
          ctx,
          changedFieldKeys: Object.keys(input.data).sort(),
          occurredAt: now(),
        });

        await resetChangedVerifications(repos, updated, verificationItemsForSection(sectionKey));

        const value = await snapshot(repos, id);
        return {
          provider: visibleOrganization(updated, actor),
          completeness: assessCompleteness(updated.providerType, value),
          warnings: check.warnings,
        };
      });
    },

    async getDoctorProfile(
      actor: Actor,
      id: string,
    ): Promise<{ profile: DoctorProfileRecord | null; practices: DoctorLocationRecord[] }> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const profile = await repositories.onboarding.findDoctorProfileByOrganizationId(id);
      return {
        profile,
        practices: profile ? await repositories.onboarding.listDoctorPractices(profile.id) : [],
      };
    },

    async saveDoctorProfile(
      actor: Actor,
      id: string,
      input: DoctorProfileSaveInput,
      ctx: RequestContext,
    ): Promise<{ profile: DoctorProfileRecord; practices: DoctorLocationRecord[] }> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const sectionFields = formSectionsFor('doctor').find(
        (section) => section.key === input.section,
      )?.fields;
      const profileKeys = new Set(
        (sectionFields ?? [])
          .filter(
            (field) =>
              field.storage.kind === 'type_data' ||
              (field.storage.kind === 'related' &&
                (field.storage.table === 'doctor_profiles' ||
                  field.storage.table === 'doctor_locations')),
          )
          .map((field) => field.key),
      );
      const profileData = Object.fromEntries(
        Object.entries(input.data).filter(([key]) => profileKeys.has(key)),
      );
      const values = validateTypeDataSection('doctor', input.section, profileData);

      return unitOfWork.transaction(async (repos) => {
        const existing = await repos.onboarding.findDoctorProfileByOrganizationId(id);
        const organizationName = (key: string): string | undefined =>
          typeof values[key] === 'string' ? (values[key] as string) : undefined;
        const fullName = organizationName('doc_full_name') ?? existing?.fullName;
        const registrationNo = organizationName('doc_reg_no') ?? existing?.registrationNo;
        const systemOfMedicine = organizationName('doc_system') ?? existing?.systemOfMedicine;
        if (!fullName || !registrationNo || !systemOfMedicine) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Doctor name, registration and system are required',
          );
        }
        const councilName = organizationName('doc_reg_council') ?? existing?.councilName ?? null;
        const specialtyName = organizationName('doc_specialty') ?? existing?.specialtyName ?? null;
        const councilId = councilName ? await resolveCouncilId(repos, councilName) : null;
        const specialtyId = specialtyName
          ? await resolveSpecialtyId(repos, specialtyName)
          : (existing?.specialtyId ?? null);
        const qualifications = Array.isArray(values.doc_qualifications)
          ? (values.doc_qualifications as Array<Record<string, unknown>>)
          : (existing?.qualifications ?? []);
        const documents = await repos.onboarding.listDocuments(id);
        const photo = documents.find((row) => row.role === 'doctor_photo' && !row.deletedAt);

        const profile = await repos.onboarding.saveDoctorProfile(
          {
            organizationId: id,
            createdByOrgId: null,
            fullName,
            mobile: existing?.mobile ?? organization.mobile,
            email: existing?.email ?? organization.email,
            registrationNo,
            councilId,
            councilName,
            systemOfMedicine,
            specialtyId,
            specialtyName,
            qualifications,
            photoDocumentId: photo?.id ?? existing?.photoDocumentId ?? null,
            status: existing?.status ?? 'doctor_confirmed',
          },
          existing?.id,
        );

        // Registration dates live on the medical-registration licence row.
        const validFrom =
          typeof input.data.doc_reg_date === 'string' ? input.data.doc_reg_date : undefined;
        const validTo =
          typeof input.data.doc_reg_valid_to === 'string' ? input.data.doc_reg_valid_to : undefined;
        if (validFrom || validTo) {
          const licences = await repos.onboarding.listLicences(id);
          const licence = licences.find((row) => row.details.role === 'medical_registration');
          if (licence) {
            await repos.onboarding.updateLicence(id, licence.id, {
              ...(validFrom ? { validFrom: new Date(`${validFrom}T00:00:00Z`) } : {}),
              ...(validTo ? { validTo: new Date(`${validTo}T00:00:00Z`) } : {}),
            });
          } else {
            await repos.onboarding.createLicence(
              id,
              {
                number: registrationNo,
                ...(councilName ? { authority: councilName } : {}),
                ...(validFrom ? { valid_from: validFrom } : {}),
                ...(validTo ? { valid_to: validTo } : {}),
                role: 'medical_registration',
                details: { role: 'medical_registration' },
              },
              newId(),
            );
          }
        }

        // Keep a type_data mirror of the profile fields too: the review screen
        // and completeness can still show a council/specialty name when master
        // data has no matching row.
        const typeDataKeys = new Set(
          (sectionFields ?? [])
            .filter(
              (field) =>
                field.storage.kind === 'type_data' ||
                (field.storage.kind === 'related' && field.storage.table === 'doctor_profiles'),
            )
            .map((field) => field.key),
        );
        const nextTypeData = { ...organization.typeData };
        let touchedTypeData = false;
        for (const [key, value] of Object.entries(input.data)) {
          if (!typeDataKeys.has(key)) continue;
          nextTypeData[key] = value;
          touchedTypeData = true;
        }
        if (touchedTypeData) {
          const updated = await repos.onboarding.updateOrganization({
            id,
            expectedVersion: input.version,
            columns: {},
            typeData: nextTypeData,
          });
          if (!updated) {
            throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
              expectedVersion: input.version,
            });
          }
        }

        await audit(repos, {
          actor,
          action: 'provider.doctor_profile.saved',
          entityId: id,
          ctx,
          changedFieldKeys: Object.keys(input.data).sort(),
          occurredAt: now(),
        });

        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection(input.section),
        );

        return {
          profile,
          practices: await repos.onboarding.listDoctorPractices(profile.id),
        };
      });
    },

    async listDoctorPractices(actor: Actor, id: string): Promise<DoctorLocationRecord[]> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const profile = await repositories.onboarding.findDoctorProfileByOrganizationId(id);
      return profile ? repositories.onboarding.listDoctorPractices(profile.id) : [];
    },

    async createDoctorPractice(
      actor: Actor,
      id: string,
      input: DoctorPracticeInput,
      ctx: RequestContext,
    ): Promise<DoctorLocationRecord> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const profile = await repositories.onboarding.findDoctorProfileByOrganizationId(id);
      if (!profile) throw new AppError('VALIDATION_ERROR', 'Save the doctor identity first');

      // Validate the practice payload against the registry section (options,
      // address shape, money and timings) before writing the row.
      validateTypeDataSection('doctor', 'doctor_practice', {
        practice_locations: [
          {
            prac_type: input.practice_type,
            ...(input.clinic_organization_id
              ? { prac_clinic_id: input.clinic_organization_id }
              : {}),
            prac_location: input.address,
            prac_timings: input.timings,
            prac_fee: input.fee_paise / 100,
            prac_contact: input.public_contact,
          },
        ],
      });
      if (input.clinic_organization_id) {
        const clinic = await repositories.onboarding.findOrganizationById(
          input.clinic_organization_id,
        );
        if (!clinic || clinic.providerType !== 'clinic') {
          throw new AppError('VALIDATION_ERROR', 'Choose an onboarded clinic to link');
        }
      }
      const practice = await unitOfWork.transaction(async (repos) => {
        const row = await repos.onboarding.createDoctorPractice(
          {
            doctorProfileId: profile.id,
            clinicOrganizationId: input.clinic_organization_id ?? null,
            practiceType: input.practice_type,
            address: input.address,
            publicContact: input.public_contact,
            timings: input.timings,
            feePaise: input.fee_paise,
          },
          newId(),
        );
        await audit(repos, {
          actor,
          action: 'provider.doctor_practice.created',
          entityId: id,
          ctx,
          occurredAt: now(),
        });
        return row;
      });
      return practice;
    },

    async updateDoctorPractice(
      actor: Actor,
      id: string,
      practiceId: string,
      input: DoctorPracticeUpdateInput,
      ctx: RequestContext,
    ): Promise<DoctorLocationRecord> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const profile = await repositories.onboarding.findDoctorProfileByOrganizationId(id);
      if (!profile) throw new AppError('NOT_FOUND', 'Doctor profile not found');
      const updated = await unitOfWork.transaction(async (repos) => {
        const row = await repos.onboarding.updateDoctorPractice(profile.id, practiceId, {
          ...(input.practice_type !== undefined ? { practiceType: input.practice_type } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.public_contact !== undefined ? { publicContact: input.public_contact } : {}),
          ...(input.timings !== undefined ? { timings: input.timings } : {}),
          ...(input.fee_paise !== undefined ? { feePaise: input.fee_paise } : {}),
        });
        if (!row) return null;
        await audit(repos, {
          actor,
          action: 'provider.doctor_practice.updated',
          entityId: id,
          ctx,
          occurredAt: now(),
        });
        return row;
      });
      if (!updated) throw new AppError('NOT_FOUND', 'Practice location not found');
      return updated;
    },

    async deleteDoctorPractice(actor: Actor, id: string, practiceId: string): Promise<void> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'doctor') notFound();
      const profile = await repositories.onboarding.findDoctorProfileByOrganizationId(id);
      if (!profile) throw new AppError('NOT_FOUND', 'Doctor profile not found');
      const removed = await unitOfWork.transaction((repos) =>
        repos.onboarding.deleteDoctorPractice(profile.id, practiceId),
      );
      if (!removed) throw new AppError('NOT_FOUND', 'Practice location not found');
    },

    async listClinicDoctors(actor: Actor, id: string): Promise<ClinicDoctorLinkRecord[]> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'clinic') notFound();
      return repositories.onboarding.listClinicDoctorLinks(id);
    },

    async searchClinicDoctors(
      actor: Actor,
      id: string,
      input: ClinicDoctorSearchInput,
    ): Promise<DoctorProfileRecord[]> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'clinic') notFound();
      const matches = await repositories.onboarding.findDoctorProfilesByRegistration(
        input.registration_no,
      );
      const council = input.council?.trim().toLowerCase();
      return matches.filter(
        (row) => !council || (row.councilName ?? '').trim().toLowerCase() === council,
      );
    },

    async addClinicDoctor(
      actor: Actor,
      id: string,
      input: ClinicDoctorCreateInput,
      ctx: RequestContext,
    ): Promise<ClinicDoctorLinkRecord> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'clinic') notFound();

      return unitOfWork.transaction(async (repos) => {
        const links = await repos.onboarding.listClinicDoctorLinks(id);
        let doctor: DoctorProfileRecord | null = null;

        if (input.doctor_profile_id) {
          doctor = await repos.onboarding.findDoctorProfileById(input.doctor_profile_id);
          if (!doctor) throw new AppError('NOT_FOUND', 'Doctor profile not found');
        } else {
          if (
            !input.full_name ||
            !input.mobile ||
            !input.registration_no ||
            !input.system_of_medicine
          ) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Doctor name, mobile, registration number and system are required',
            );
          }
          const existing = await repos.onboarding.findDoctorProfilesByRegistration(
            input.registration_no,
          );
          const council = input.council?.trim().toLowerCase();
          const match = existing.find(
            (row) => !council || (row.councilName ?? '').trim().toLowerCase() === council,
          );
          if (match) {
            throw new AppError(
              'CONFLICT',
              'A doctor with this registration number and council already exists. Link the existing profile instead.',
              { existingDoctor: match },
            );
          }
          const councilId = input.council ? await resolveCouncilId(repos, input.council) : null;
          const specialtyId = input.specialty
            ? await resolveSpecialtyId(repos, input.specialty)
            : null;
          doctor = await repos.onboarding.saveDoctorProfile({
            organizationId: null,
            createdByOrgId: id,
            fullName: input.full_name,
            mobile: input.mobile,
            email: input.email ?? null,
            registrationNo: input.registration_no,
            councilId,
            councilName: input.council ?? null,
            systemOfMedicine: input.system_of_medicine,
            specialtyId,
            specialtyName: input.specialty ?? null,
            qualifications: input.qualifications ?? [],
            status: 'invited',
          });
        }

        if (!doctor) throw new AppError('VALIDATION_ERROR', 'Doctor profile is required');
        if (links.some((row) => row.doctor.id === doctor.id)) {
          throw new AppError('CONFLICT', 'This doctor is already linked to the clinic');
        }
        const link = await repos.onboarding.createClinicDoctorLink(
          {
            doctorProfileId: doctor.id,
            clinicOrganizationId: id,
            roleAtClinic: input.role_at_clinic,
            timings: input.timings,
            feePaise: input.fee_paise,
          },
          newId(),
        );
        const linkedAt = now();
        await audit(repos, {
          actor,
          action: 'provider.clinic_doctor.linked',
          entityId: id,
          ctx,
          changedFieldKeys: ['doctor', 'role_at_clinic', 'timings', 'fee_paise'],
          occurredAt: linkedAt,
        });
        await repos.outbox.append({
          id: newId(),
          eventType: 'doctor.linked_to_clinic',
          eventVersion: outboxEventVersions['doctor.linked_to_clinic'],
          aggregateType: 'provider_organization',
          aggregateId: id,
          payload: {
            organizationId: id,
            doctorProfileId: doctor.id,
            clinicLinkId: link.link.id,
            actorUserId: actor.userId,
          },
          occurredAt: linkedAt,
          dedupeKey: `doctor-link:${link.link.id}`,
        });
        return link;
      });
    },

    async updateClinicDoctor(
      actor: Actor,
      id: string,
      linkId: string,
      input: ClinicDoctorUpdateInput,
    ): Promise<ClinicDoctorLinkRecord> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'clinic') notFound();
      const updated = await unitOfWork.transaction((repos) =>
        repos.onboarding.updateClinicDoctorLink(id, linkId, {
          ...(input.role_at_clinic !== undefined ? { roleAtClinic: input.role_at_clinic } : {}),
          ...(input.timings !== undefined ? { timings: input.timings } : {}),
          ...(input.fee_paise !== undefined ? { feePaise: input.fee_paise } : {}),
        }),
      );
      if (!updated) throw new AppError('NOT_FOUND', 'Clinic doctor link not found');
      return updated;
    },

    async removeClinicDoctor(actor: Actor, id: string, linkId: string): Promise<void> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'clinic') notFound();
      const removed = await unitOfWork.transaction((repos) =>
        repos.onboarding.deleteClinicDoctorLink(id, linkId),
      );
      if (!removed) throw new AppError('NOT_FOUND', 'Clinic doctor link not found');
    },

    submit(
      actor: Actor,
      id: string,
      input: SubmitOrganizationInput,
      ctx: RequestContext,
    ): Promise<OrganizationDetail> {
      return submitOrganization(actor, id, input, ctx);
    },

    async transitionStatus(
      actor: Actor,
      id: string,
      input: TransitionOrganizationInput,
      ctx: RequestContext,
      meta: {
        scope?: SuspensionScope | null;
        scopeRefId?: string | null;
        scopeLabel?: string | null;
        flaggedSections?: string[];
      } = {},
    ): Promise<ProviderOrganizationRecord> {
      const organization = await load(actor, id);

      if (input.to === 'SUBMITTED') {
        await submitOrganization(actor, id, { version: input.version, note: input.reason }, ctx);
        return load(actor, id);
      }

      return unitOfWork.transaction((repos) =>
        transition(repos, organization, input.to, actor, ctx, {
          version: input.version,
          reason: input.reason ?? null,
          validationPassed: false,
          ...meta,
        }),
      );
    },

    async listDuplicateWarnings(actor: Actor, id: string): Promise<DuplicateCheck> {
      const organization = await load(actor, id);
      return duplicates(repositories, {
        organizationId: organization.id,
        ...scope(actor),
        registrationNumber: organization.registrationNumber,
        mobile: organization.mobile,
        pinCode: organization.primaryPinCode,
        legalName: organization.legalName,
        doctorRegistrationNo:
          typeof organization.typeData.doc_reg_no === 'string'
            ? organization.typeData.doc_reg_no
            : null,
      });
    },

    async dismissDuplicate(
      actor: Actor,
      id: string,
      input: { duplicate_provider_id: string; reason?: string },
      ctx: RequestContext,
    ): Promise<{ dismissed: true }> {
      if (actor.role !== 'ADMIN') {
        throw new AppError('FORBIDDEN', 'Only administrators can dismiss a duplicate warning');
      }
      await load(actor, id);
      const occurredAt = now();
      await unitOfWork.transaction(async (repos) => {
        await repos.onboarding.dismissDuplicate({
          id: newId(),
          organizationId: id,
          duplicateOrganizationId: input.duplicate_provider_id,
          dismissedByUserId: actor.userId,
          reason: input.reason ?? null,
          at: occurredAt,
        });
        await audit(repos, {
          actor,
          action: 'provider.duplicate.dismissed',
          entityId: id,
          ctx,
          reason: input.reason ?? null,
          occurredAt,
        });
      });
      return { dismissed: true };
    },

    async listLocations(actor: Actor, id: string): Promise<ProviderLocationRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listLocations(id);
    },

    async createLocation(
      actor: Actor,
      id: string,
      input: LocationInput,
    ): Promise<{
      location: ProviderLocationRecord;
      provider: ProviderOrganizationRecord;
      warnings: DuplicateMatch[];
    }> {
      const organization = await load(actor, id);
      return unitOfWork.transaction(async (repos) => {
        const existing = await repos.onboarding.listLocations(id);
        const makePrimary = input.is_primary === true || existing.length === 0;
        if (makePrimary) await repos.onboarding.clearPrimaryLocations(id);
        const location = await repos.onboarding.createLocation(
          id,
          { ...(toLocation(input) as OnboardingLocationInput), isPrimary: makePrimary },
          newId(),
        );
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('locations'),
        );
        if (!location.isPrimary) {
          return {
            location,
            provider: visibleOrganization(organization, actor),
            warnings: [],
          };
        }
        return {
          location,
          ...(await applyPrimaryLocation(repos, organization, location, actor)),
        };
      });
    },

    async updateLocation(
      actor: Actor,
      id: string,
      locationId: string,
      input: LocationUpdateInput,
    ): Promise<{
      location: ProviderLocationRecord;
      provider: ProviderOrganizationRecord;
      warnings: DuplicateMatch[];
    }> {
      const organization = await load(actor, id);
      return unitOfWork.transaction(async (repos) => {
        if (input.is_primary === true) {
          await repos.onboarding.clearPrimaryLocations(id, locationId);
        }
        const location = await repos.onboarding.updateLocation(id, locationId, toLocation(input));
        if (!location) throw new AppError('NOT_FOUND', 'Location not found');
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('locations'),
        );
        if (!location.isPrimary) {
          return {
            location,
            provider: visibleOrganization(organization, actor),
            warnings: [],
          };
        }
        return {
          location,
          ...(await applyPrimaryLocation(repos, organization, location, actor)),
        };
      });
    },

    async deleteLocation(actor: Actor, id: string, locationId: string): Promise<void> {
      const organization = await load(actor, id);
      await unitOfWork.transaction(async (repos) => {
        const rows = await repos.onboarding.listLocations(id);
        const target = rows.find((row) => row.id === locationId);
        if (!target) throw new AppError('NOT_FOUND', 'Location not found');
        await repos.onboarding.deleteLocation(id, locationId);
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('locations'),
        );
        if (target.isPrimary) {
          await repos.onboarding.updateOrganization({
            id,
            expectedVersion: organization.version,
            columns: { primaryPinCode: null, primaryDistrictId: null, primaryStateId: null },
          });
        }
      });
    },

    async listContacts(actor: Actor, id: string): Promise<ProviderContactRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listContacts(id);
    },

    async saveContact(
      actor: Actor,
      id: string,
      input: ContactInput,
    ): Promise<ProviderContactRecord> {
      await load(actor, id);
      return unitOfWork.transaction((repos) => repos.onboarding.upsertContact(id, input, newId()));
    },

    async deleteContact(actor: Actor, id: string, contactId: string): Promise<void> {
      await load(actor, id);
      const removed = await unitOfWork.transaction((repos) =>
        repos.onboarding.deleteContact(id, contactId),
      );
      if (!removed) throw new AppError('NOT_FOUND', 'Contact not found');
    },

    async listLicences(actor: Actor, id: string): Promise<ProviderLicenceRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listLicences(id);
    },

    async createLicence(
      actor: Actor,
      id: string,
      input: LicenceInput,
    ): Promise<ProviderLicenceRecord> {
      const organization = await load(actor, id);
      assertLicenceRow(organization.providerType, {
        ...(input.role ? { role: input.role } : {}),
        number: input.number,
        ...(input.authority ? { authority: input.authority } : {}),
        ...(input.issued_on ? { issued_on: input.issued_on } : {}),
        ...(input.valid_from ? { valid_from: input.valid_from } : {}),
        ...(input.valid_to ? { valid_to: input.valid_to } : {}),
        ...(input.document_id ? { document_id: input.document_id } : {}),
        details: input.details,
      });
      return unitOfWork.transaction(async (repos) => {
        const check = await duplicates(repos, {
          organizationId: id,
          licenceNumber: input.number,
          ...scope(actor),
        });
        throwBlocked(check);
        const licence = await repos.onboarding.createLicence(
          id,
          {
            ...(toLicence(input) as OnboardingLicenceInput),
            number: input.number,
            details: { ...(input.details ?? {}), ...(input.role ? { role: input.role } : {}) },
          },
          newId(),
        );
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('licences'),
        );
        return licence;
      });
    },

    async updateLicence(
      actor: Actor,
      id: string,
      licenceId: string,
      input: LicenceUpdateInput,
    ): Promise<ProviderLicenceRecord> {
      const organization = await load(actor, id);
      return unitOfWork.transaction(async (repos) => {
        if (input.number) {
          const check = await duplicates(repos, {
            organizationId: id,
            licenceNumber: input.number,
            ...scope(actor),
          });
          throwBlocked(check);
        }
        const existing = (await repos.onboarding.listLicences(id)).find(
          (row) => row.id === licenceId,
        );
        if (!existing) throw new AppError('NOT_FOUND', 'Licence not found');
        // The registry rules apply to the merged row, so a partial edit cannot
        // drop a required licence detail.
        assertLicenceRow(organization.providerType, {
          role:
            input.role ??
            (typeof existing.details.role === 'string' ? existing.details.role : undefined),
          number: input.number ?? existing.number,
          ...((input.authority ?? existing.authority)
            ? { authority: input.authority ?? existing.authority ?? undefined }
            : {}),
          ...((input.issued_on ?? existing.issuedOn)
            ? {
                issued_on:
                  input.issued_on ?? existing.issuedOn?.toISOString().slice(0, 10) ?? undefined,
              }
            : {}),
          ...((input.valid_from ?? existing.validFrom)
            ? {
                valid_from:
                  input.valid_from ?? existing.validFrom?.toISOString().slice(0, 10) ?? undefined,
              }
            : {}),
          ...((input.valid_to ?? existing.validTo)
            ? {
                valid_to:
                  input.valid_to ?? existing.validTo?.toISOString().slice(0, 10) ?? undefined,
              }
            : {}),
          ...((input.document_id ?? existing.documentId)
            ? { document_id: input.document_id ?? existing.documentId ?? undefined }
            : {}),
          details: { ...existing.details, ...(input.details ?? {}) },
        });
        const updated = await repos.onboarding.updateLicence(id, licenceId, {
          ...toLicence(input),
          ...(input.role !== undefined
            ? { details: { ...existing.details, ...(input.details ?? {}), role: input.role } }
            : {}),
        });
        if (!updated) throw new AppError('NOT_FOUND', 'Licence not found');
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('licences'),
        );
        return updated;
      });
    },

    async deleteLicence(actor: Actor, id: string, licenceId: string): Promise<void> {
      const organization = await load(actor, id);
      const removed = await unitOfWork.transaction(async (repos) => {
        const deleted = await repos.onboarding.deleteLicence(id, licenceId);
        if (deleted) {
          await resetChangedVerifications(
            repos,
            organization,
            verificationItemsForSection('licences'),
          );
        }
        return deleted;
      });
      if (!removed) throw new AppError('NOT_FOUND', 'Licence not found');
    },

    async listInsurance(actor: Actor, id: string): Promise<ProviderInsuranceRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listInsurance(id);
    },

    async createInsurance(
      actor: Actor,
      id: string,
      input: InsuranceInput,
    ): Promise<ProviderInsuranceRecord> {
      const organization = await load(actor, id);
      return unitOfWork.transaction(async (repos) => {
        const policy = await repos.onboarding.createInsurance(
          id,
          toInsurance(input) as OnboardingInsuranceInput,
          newId(),
        );
        await resetChangedVerifications(
          repos,
          organization,
          verificationItemsForSection('insurance'),
        );
        return policy;
      });
    },

    async updateInsurance(
      actor: Actor,
      id: string,
      insuranceId: string,
      input: InsuranceUpdateInput,
    ): Promise<ProviderInsuranceRecord> {
      const organization = await load(actor, id);
      const updated = await unitOfWork.transaction(async (repos) => {
        const policy = await repos.onboarding.updateInsurance(id, insuranceId, toInsurance(input));
        if (policy) {
          await resetChangedVerifications(
            repos,
            organization,
            verificationItemsForSection('insurance'),
          );
        }
        return policy;
      });
      if (!updated) throw new AppError('NOT_FOUND', 'Insurance policy not found');
      return updated;
    },

    async deleteInsurance(actor: Actor, id: string, insuranceId: string): Promise<void> {
      const organization = await load(actor, id);
      const removed = await unitOfWork.transaction(async (repos) => {
        const deleted = await repos.onboarding.deleteInsurance(id, insuranceId);
        if (deleted) {
          await resetChangedVerifications(
            repos,
            organization,
            verificationItemsForSection('insurance'),
          );
        }
        return deleted;
      });
      if (!removed) throw new AppError('NOT_FOUND', 'Insurance policy not found');
    },

    async listServicePins(actor: Actor, id: string): Promise<ProviderServicePinRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listServicePins(id);
    },

    async addServicePin(
      actor: Actor,
      id: string,
      input: ServicePinInput,
    ): Promise<ProviderServicePinRecord> {
      await load(actor, id);
      return unitOfWork.transaction((repos) =>
        repos.onboarding.addServicePin(
          id,
          { pinCode: input.pin_code, serviceKind: input.service_kind },
          newId(),
        ),
      );
    },

    async removeServicePin(actor: Actor, id: string, pinId: string): Promise<void> {
      await load(actor, id);
      const removed = await unitOfWork.transaction((repos) =>
        repos.onboarding.removeServicePin(id, pinId),
      );
      if (!removed) throw new AppError('NOT_FOUND', 'Service area PIN not found');
    },

    async listDocuments(actor: Actor, id: string): Promise<ProviderDocumentRecord[]> {
      await load(actor, id);
      return repositories.onboarding.listDocuments(id);
    },

    async createDocument(
      actor: Actor,
      id: string,
      input: DocumentInput,
    ): Promise<ProviderDocumentRecord> {
      await load(actor, id);
      return unitOfWork.transaction((repos) =>
        repos.onboarding.createDocument(
          id,
          { ...toDocument(input), uploadedByUserId: actor.userId },
          newId(),
        ),
      );
    },

    async deleteDocument(actor: Actor, id: string, documentId: string): Promise<void> {
      await load(actor, id);
      const removed = await unitOfWork.transaction((repos) =>
        repos.onboarding.deleteDocument(id, documentId, now()),
      );
      if (!removed) throw new AppError('NOT_FOUND', 'Document not found');
    },

    async listStatusHistory(actor: Actor, id: string) {
      await load(actor, id);
      return repositories.onboarding.listStatusHistory(id, listLimit);
    },

    /** CSV template for a diagnostic catalogue (field-spec 8.3). */
    async testCatalogueTemplate(
      actor: Actor,
      id: string,
    ): Promise<{ fileName: string; csv: string }> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'diagnostic_centre') notFound();
      return {
        fileName: `${organization.code}-test-catalogue.csv`,
        csv: testCatalogueTemplateCsv(),
      };
    },

    /**
     * Bulk test-catalogue import. Rows are validated against the registry's
     * `dc_tests` repeater; sex-determination rows are refused, prenatal rows are
     * imported and queued for admin review.
     */
    async importTestCatalogue(
      actor: Actor,
      id: string,
      input: TestCatalogueImportPayload,
      ctx: RequestContext,
    ): Promise<{ report: TestCatalogueImportReport; version: number }> {
      const organization = await load(actor, id);
      if (organization.providerType !== 'diagnostic_centre') notFound();

      const existingTests = Array.isArray(organization.typeData.dc_tests)
        ? (organization.typeData.dc_tests as Array<Record<string, unknown>>)
        : [];
      const report = importTestCatalogueCsv({
        csv: input.csv,
        context: organization.typeData,
        existing: existingTests,
      });
      if (report.headerIssues.length > 0) {
        throw new AppError('VALIDATION_ERROR', 'The CSV file does not match the template', {
          issues: report.headerIssues,
          report,
        });
      }
      if (report.tests.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No catalogue rows could be imported', { report });
      }

      const existingFlags = Array.isArray(organization.typeData.dc_test_review_flags)
        ? (organization.typeData.dc_test_review_flags as Array<Record<string, unknown>>)
        : [];
      const newFlags = report.rows
        .filter((row) => row.status === 'flagged')
        .map((row) => ({
          test_name: row.testName ?? '',
          reason: row.flags[0] ?? 'Flagged for admin review',
          status: 'pending review',
        }));

      const updated = await unitOfWork.transaction(async (repos) => {
        const row = await repos.onboarding.updateOrganization({
          id,
          expectedVersion: input.version ?? organization.version,
          columns: {},
          typeData: {
            ...organization.typeData,
            dc_tests: [...existingTests, ...report.tests],
            dc_test_review_flags: [...existingFlags, ...newFlags],
          },
        });
        if (!row) {
          throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
            expectedVersion: input.version ?? organization.version,
          });
        }
        await audit(repos, {
          actor,
          action: 'provider.test_catalogue.imported',
          entityId: id,
          ctx,
          changedFieldKeys: ['dc_tests', 'dc_test_review_flags'],
          occurredAt: now(),
        });
        return row;
      });

      return { report, version: updated.version };
    },

    /** Admin-only switches (pharmacy online sale, field-spec 7.5). */
    async updateAdminSwitches(
      actor: Actor,
      id: string,
      input: AdminSwitchesInput,
      ctx: RequestContext,
    ): Promise<ProviderOrganizationRecord> {
      if (actor.role !== 'ADMIN') {
        throw new AppError('FORBIDDEN', 'Only administrators can change these switches');
      }
      const organization = await load(actor, id);
      const allowed = new Map(
        adminOnlyFieldsFor(organization.providerType).map((field) => [field.key, field]),
      );
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input.data)) {
        const field = allowed.get(key);
        if (!field) {
          throw new AppError('VALIDATION_ERROR', `${key} is not an admin-controlled field`, {
            issues: [{ path: key, message: `${key} is not an admin-controlled field` }],
          });
        }
        Object.assign(
          values,
          validateAdminTypeDataSection(organization.providerType, field.section, { [key]: value }),
        );
      }

      return unitOfWork.transaction(async (repos) => {
        const row = await repos.onboarding.updateOrganization({
          id,
          expectedVersion: input.version ?? organization.version,
          columns: {},
          typeData: { ...organization.typeData, ...values },
        });
        if (!row) {
          throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
            expectedVersion: input.version ?? organization.version,
          });
        }
        await audit(repos, {
          actor,
          action: 'provider.admin_switches.updated',
          entityId: id,
          ctx,
          changedFieldKeys: Object.keys(values).sort(),
          occurredAt: now(),
        });
        return row;
      });
    },

    /** Admin-only decision on higher-risk workflows (field-spec 8.2). */
    async updateHighRiskStatuses(
      actor: Actor,
      id: string,
      input: HighRiskStatusInput,
      ctx: RequestContext,
    ): Promise<ProviderOrganizationRecord> {
      if (actor.role !== 'ADMIN') {
        throw new AppError('FORBIDDEN', 'Only administrators can approve workflows');
      }
      const organization = await load(actor, id);
      if (organization.providerType !== 'diagnostic_centre') notFound();

      const requested = Array.isArray(organization.typeData.dc_highrisk_requests)
        ? (organization.typeData.dc_highrisk_requests as string[])
        : [];
      const unknown = input.statuses.filter((entry) => !requested.includes(entry.workflow));
      if (unknown.length > 0) {
        throw new AppError('VALIDATION_ERROR', 'The provider has not requested these workflows', {
          issues: unknown.map((entry) => ({ path: entry.workflow, message: 'Not requested' })),
        });
      }
      const current = Array.isArray(organization.typeData.dc_highrisk_status)
        ? (organization.typeData.dc_highrisk_status as Array<Record<string, unknown>>)
        : [];
      const decidedAt = now().toISOString().slice(0, 10);
      const statuses = input.statuses.map((entry) => ({
        workflow: entry.workflow,
        status: entry.status,
        decided_at: decidedAt,
        decided_by: actor.userId,
      }));
      const merged = [
        ...current.filter((row) => !statuses.some((entry) => entry.workflow === row.workflow)),
        ...statuses,
      ];

      return unitOfWork.transaction(async (repos) => {
        const row = await repos.onboarding.updateOrganization({
          id,
          expectedVersion: input.version ?? organization.version,
          columns: {},
          typeData: { ...organization.typeData, dc_highrisk_status: merged },
        });
        if (!row) {
          throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
            expectedVersion: input.version ?? organization.version,
          });
        }
        await audit(repos, {
          actor,
          action: 'provider.highrisk_status.updated',
          entityId: id,
          ctx,
          changedFieldKeys: ['dc_highrisk_status'],
          occurredAt: now(),
        });
        return row;
      });
    },
  };

  async function submitOrganization(
    actor: Actor,
    id: string,
    input: SubmitOrganizationInput,
    ctx: RequestContext,
  ): Promise<OrganizationDetail> {
    let organization = await load(actor, id);
    // Check the transition itself first: an approval-stage provider must hear
    // "invalid transition", not "incomplete form".
    assertOrganizationTransition({
      from: organization.status,
      to: 'SUBMITTED',
      actor,
      ownerUserId: organization.createdByUserId,
      validationPassed: true,
    });
    const { completeness } = await withSnapshot(id);

    if (!completeness.complete) {
      throw new AppError('VALIDATION_ERROR', 'Complete the missing sections before submitting', {
        completeness,
      });
    }

    // Required consents (field spec 3.9 and 9.1). Agreement acceptance is
    // required only when an active template exists for the provider type.
    const [consents, templates] = await Promise.all([
      repositories.consents.listByOrganization(id),
      repositories.consents.listTemplates(organization.providerType),
    ]);
    const gaps = consentGaps({
      providerType: organization.providerType,
      records: consents,
      agreementRequired: templates.some((template) => template.status === 'active'),
    });
    if (gaps.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Record the required consents before submitting', {
        consents: gaps,
      });
    }

    if (organization.providerType === 'clinic') {
      const links = await repositories.onboarding.listClinicDoctorLinks(id);
      const incharge =
        typeof organization.typeData.clinic_incharge === 'string'
          ? organization.typeData.clinic_incharge
          : null;
      if (links.length === 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Add at least one doctor to the clinic before submitting',
        );
      }
      if (!incharge || !links.some((row) => row.doctor.id === incharge)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Select an in-charge doctor from the clinic doctors before submitting',
        );
      }
    }

    // Every requested higher-risk workflow starts life as "requested" so the
    // admin queue is complete as soon as the provider submits (field-spec 8.2).
    let versionBumped = false;
    if (organization.providerType === 'diagnostic_centre') {
      const requested = Array.isArray(organization.typeData.dc_highrisk_requests)
        ? (organization.typeData.dc_highrisk_requests as string[])
        : [];
      const current = Array.isArray(organization.typeData.dc_highrisk_status)
        ? (organization.typeData.dc_highrisk_status as Array<Record<string, unknown>>)
        : [];
      const missing = requested.filter(
        (workflow) => !current.some((row) => row.workflow === workflow),
      );
      if (missing.length > 0) {
        const seeded = await unitOfWork.transaction((repos) =>
          repos.onboarding.updateOrganization({
            id,
            expectedVersion: organization.version,
            columns: {},
            typeData: {
              ...organization.typeData,
              dc_highrisk_status: [
                ...current,
                ...missing.map((workflow) => ({ workflow, status: 'requested' })),
              ],
            },
          }),
        );
        if (!seeded) {
          throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
            expectedVersion: organization.version,
          });
        }
        organization = seeded;
        versionBumped = true;
      }
    }

    const issues = collectTypeDataIssues(organization.providerType, organization.typeData, {
      mode: 'submit',
      moneyFormat: 'paise',
    });
    if (issues.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'The provider details are invalid', { issues });
    }

    const updated = await unitOfWork.transaction(async (repos) => {
      const transitioned = await transition(repos, organization, 'SUBMITTED', actor, ctx, {
        // The seeding above is our own write, so the client's version is one
        // behind; the freshly loaded version is the one to compare.
        version: versionBumped ? organization.version : (input.version ?? organization.version),
        reason: input.note ?? null,
        validationPassed: true,
      });

      // The review checklist is generated from the field registry at submit.
      await repos.reviews.seed(
        transitioned.id,
        requiredVerificationItemsFor(transitioned.providerType),
      );
      if (transitioned.providerType === 'clinic') {
        const links = await repos.onboarding.listClinicDoctorLinks(transitioned.id);
        for (const link of links) {
          await repos.reviews.seedDoctor(link.doctor.id, doctorVerificationItems());
        }
      }
      return transitioned;
    });

    const refreshed = await snapshot(repositories, updated.id);
    return {
      ...refreshed,
      organization: visibleOrganization(refreshed.organization, actor),
      completeness: assessCompleteness(updated.providerType, refreshed),
    };
  }

  /**
   * Licence rows are registry repeaters: the sub-fields the registry marks
   * required (form type, scope, validity, certificate) are enforced here, not
   * just in the form, so the API cannot store an incomplete licence.
   */
  function assertLicenceRow(
    providerType: ProviderType,
    input: {
      role?: string;
      number?: string;
      authority?: string;
      issued_on?: string;
      valid_from?: string;
      valid_to?: string;
      document_id?: string;
      details?: Record<string, unknown>;
    },
  ): void {
    const role =
      input.role ??
      (typeof input.details?.role === 'string' ? (input.details.role as string) : undefined);
    if (!role) return;
    const field = sectionsForProvider(providerType)
      .flatMap((section) => section.fields)
      .find(
        (entry) =>
          entry.storage.kind === 'related' &&
          entry.storage.table === 'provider_licences' &&
          entry.storage.role === role &&
          (entry.items?.length ?? 0) > 0,
      );
    if (!field) return;

    // `role` is the licence's registry key, not one of the repeater's sub-fields.
    const { role: _ignored, ...detailValues } = input.details ?? {};
    const row: Record<string, unknown> = {
      ...detailValues,
      ...(input.number ? { number: input.number } : {}),
      ...(input.authority ? { authority: input.authority } : {}),
      ...(input.issued_on ? { issue_date: input.issued_on } : {}),
      ...(input.valid_from ? { valid_from: input.valid_from } : {}),
      ...(input.valid_to ? { valid_to: input.valid_to } : {}),
    };
    const issues = parseRepeaterItem(providerType, field.key, row).issues.filter(
      (issue) => issue.path !== 'document',
    );
    for (const item of field.items ?? []) {
      if (item.type !== 'file' || item.requirement !== 'required') continue;
      if (!input.document_id) {
        issues.push({ path: item.key, message: `${item.label} is required` });
      }
    }
    if (issues.length > 0) {
      throw new AppError('VALIDATION_ERROR', `The ${field.label} details are incomplete`, {
        sectionKey: field.section,
        issues,
      });
    }
  }

  /**
   * Denormalizes the primary location onto the organization and, when the
   * primary PIN actually changes, warns about another provider with the same
   * mobile number covering that PIN. This is the only place a PIN changes.
   */
  async function applyPrimaryLocation(
    repos: Repositories,
    organization: ProviderOrganizationRecord,
    location: ProviderLocationRecord,
    actor: Actor,
  ): Promise<{ provider: ProviderOrganizationRecord; warnings: DuplicateMatch[] }> {
    const provider = await syncPrimary(repos, organization, location, actor);
    const visible = visibleOrganization(provider, actor);
    if (location.pinCode === organization.primaryPinCode || !provider.mobile) {
      return { provider: visible, warnings: [] };
    }
    const check = await duplicates(repos, {
      organizationId: organization.id,
      mobile: provider.mobile,
      pinCode: location.pinCode,
      ...scope(actor),
    });
    return { provider: visible, warnings: check.warnings };
  }

  /** Keeps the denormalized primary address columns in step with the location. */
  async function syncPrimary(
    repos: Repositories,
    organization: ProviderOrganizationRecord,
    location: ProviderLocationRecord,
    actor: Actor,
  ): Promise<ProviderOrganizationRecord> {
    if (
      organization.primaryPinCode === location.pinCode &&
      organization.primaryDistrictId === location.districtId &&
      organization.primaryStateId === location.stateId
    ) {
      return organization;
    }
    const updated = await repos.onboarding.updateOrganization({
      id: organization.id,
      expectedVersion: organization.version,
      columns: {
        primaryPinCode: location.pinCode,
        primaryDistrictId: location.districtId,
        primaryStateId: location.stateId,
      },
    });
    if (!updated) {
      throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
        expectedVersion: organization.version,
      });
    }

    // The PIN read model is event-driven: a moved primary location must reach
    // the worker even though the location itself is a separate aggregate.
    const payload = organizationEventPayloadSchema.parse({
      organizationId: updated.id,
      providerType: updated.providerType,
      status: updated.status,
      recordVersion: updated.version,
      actorUserId: actor.userId,
      changedFieldKeys: ['primary_pin_code'],
    });
    assertEventPayloadIsSafe(payload as Record<string, unknown>);
    await repos.outbox.append({
      id: newId(),
      eventType: 'provider.updated',
      eventVersion: outboxEventVersions['provider.updated'],
      aggregateType: 'provider_organization',
      aggregateId: updated.id,
      payload: payload as Record<string, unknown>,
      occurredAt: new Date(),
      dedupeKey: `${updated.id}:primary-pin:${updated.version}`,
    });

    return updated;
  }
}
