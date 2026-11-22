import { createHash, randomBytes } from 'node:crypto';
import {
  AppError,
  agreementDeferredNote,
  agreementTemplateDefinitions,
  assertEventPayloadIsSafe,
  consentEventPayloadSchema,
  consentTextVersion,
  declarationByKey,
  declarationsFor,
  consentGaps,
  isOwnerEditableStatus,
  outboxEventVersions,
  type Actor,
  type AgreementAcceptanceInput,
  type AgreementAcceptanceRecord,
  type AgreementTemplateRecord,
  type ConfirmationRequestInput,
  type ConsentCaptureInput,
  type ConsentGap,
  type ConsentRecord,
  type PublicConfirmationInput,
  type Repositories,
  type DeclarationDefinition,
  type ProviderOrganizationRecord,
  type ProviderType,
} from '@curenear/shared';
import type { ObjectStorage } from '@/server/documents/object-storage';
import type { RequestContext, ServiceDeps } from './service-deps';
import { createSmsOtpProvider, hashOtp, type ConfirmationProvider } from './confirmation-providers';

export interface ConsentServiceDeps extends ServiceDeps {
  appUrl: string;
  environment: string;
  confirmationLinksEnabled: boolean;
  storage?: ObjectStorage;
}

const LINK_TTL_HOURS = 48;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface ConsentOverview {
  organizationId: string;
  providerType: ProviderType;
  consents: ConsentRecord[];
  agreements: AgreementAcceptanceRecord[];
  templates: AgreementTemplateRecord[];
  activeTemplate: AgreementTemplateRecord | null;
  declarations: DeclarationDefinition[];
  gaps: ConsentGap[];
  agreementRequired: boolean;
  agreementDeferredNote: string;
  confirmations: Array<{
    id: string;
    doctorProfileId: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    role: string | null;
    mimeType: string;
    createdAt: Date;
  }>;
  clinicDoctors: Array<{ id: string; fullName: string; status: string; confirmed: boolean }>;
  linksEnabled: boolean;
}

export interface ConfirmationView {
  state: 'open' | 'expired' | 'used' | 'revoked';
  organizationName: string;
  providerType: ProviderType;
  providerCode: string;
  expiresAt: Date;
  doctorProfileId: string | null;
  declarations: DeclarationDefinition[];
  hasDoctor: boolean;
}

function assertConsentEvidence(evidenceDocumentId: string | null | undefined): string | null {
  return evidenceDocumentId ?? null;
}

export function createConsentService(deps: ConsentServiceDeps) {
  const { repositories, unitOfWork, now, newId, appUrl, environment, confirmationLinksEnabled } =
    deps;

  const smsProvider: ConfirmationProvider = createSmsOtpProvider({ environment });
  let templatesSeeded: Promise<void> | null = null;

  function notFound(): never {
    throw new AppError('NOT_FOUND', 'Provider not found');
  }

  async function loadOrganization(actor: Actor, id: string): Promise<ProviderOrganizationRecord> {
    const organization = await repositories.onboarding.findOrganizationById(id, {
      includeDeleted: true,
    });
    if (!organization || organization.deletedAt) notFound();
    if (actor.role !== 'ADMIN' && organization.createdByUserId !== actor.userId) notFound();
    return organization;
  }

  function assertEditable(actor: Actor, organization: ProviderOrganizationRecord): void {
    if (actor.role === 'ADMIN') return;
    if (organization.createdByUserId !== actor.userId) notFound();
    if (!isOwnerEditableStatus(organization.status)) {
      throw new AppError(
        'CONFLICT',
        'This provider has been submitted and its consents can no longer be changed',
      );
    }
  }

  function audit(
    repos: Repositories,
    input: {
      actorUserId: string | null;
      actorRole: Actor['role'] | null;
      action: string;
      consentId: string;
      ctx: RequestContext;
      reason?: string | null;
      changedFieldKeys?: string[];
    },
  ): Promise<void> {
    return repos.audits.append({
      id: newId(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: 'consent',
      entityId: input.consentId,
      requestId: input.ctx.requestId,
      changedFieldKeys: input.changedFieldKeys ?? [],
      fromStatus: null,
      toStatus: null,
      reason: input.reason ?? null,
      ipAddress: input.ctx.ipAddress,
      userAgent: input.ctx.userAgent,
      createdAt: now(),
    });
  }

  async function emitConsentEvent(
    repos: Repositories,
    input: {
      organizationId: string;
      providerType: ProviderType;
      consentId: string;
      consentType: string;
      method: string;
      actorUserId: string | null;
      publicationPermissionOff?: boolean;
    },
  ): Promise<void> {
    const event =
      input.publicationPermissionOff === undefined
        ? ('consent.captured' as const)
        : ('consent.revoked' as const);
    const payload = consentEventPayloadSchema.parse({
      providerId: input.organizationId,
      consentId: input.consentId,
      consentType: input.consentType,
      method: input.method,
      actorUserId: input.actorUserId,
      ...(input.publicationPermissionOff === undefined
        ? {}
        : { publicationPermissionOff: input.publicationPermissionOff }),
    });
    assertEventPayloadIsSafe(payload as Record<string, unknown>);
    void input.providerType;
    await repos.outbox.append({
      id: newId(),
      eventType: event,
      eventVersion: outboxEventVersions[event],
      aggregateType: 'provider_organization',
      aggregateId: input.organizationId,
      payload: payload as Record<string, unknown>,
      occurredAt: now(),
      dedupeKey: `${input.consentId}:${event}`,
    });
  }

  /** Templates are code-owned; the row exists so acceptances can reference it. */
  async function ensureTemplates(repos: Repositories): Promise<void> {
    if (templatesSeeded) return templatesSeeded;
    templatesSeeded = (async () => {
      for (const definition of agreementTemplateDefinitions) {
        await repos.consents.saveTemplate({
          id: newId(),
          providerType: definition.providerType,
          name: definition.name,
          version: definition.version,
          effectiveFrom: new Date(`${definition.effectiveFrom}T00:00:00Z`),
          body: definition.body,
          bodyHash: sha256(definition.body),
        });
      }
    })().catch((error: unknown) => {
      templatesSeeded = null;
      throw error;
    });
    return templatesSeeded;
  }

  async function overviewFor(
    repos: Repositories,
    organization: ProviderOrganizationRecord,
  ): Promise<ConsentOverview> {
    const [consents, agreements, templates, documents, links, clinicLinks] = await Promise.all([
      repos.consents.listByOrganization(organization.id),
      repos.consents.listAgreements(organization.id),
      repos.consents.listTemplates(organization.providerType),
      repos.onboarding.listDocuments(organization.id),
      repos.consents.listConfirmationRequests(organization.id),
      organization.providerType === 'clinic'
        ? repos.onboarding.listClinicDoctorLinks(organization.id)
        : Promise.resolve([]),
    ]);

    const activeTemplate =
      templates.find((template) => template.status === 'active') ??
      (organization.providerType === 'clinic' ? null : null);
    const declarations = declarationsFor(organization.providerType);
    const gaps = consentGaps({
      providerType: organization.providerType,
      records: consents,
      agreementRequired: Boolean(activeTemplate),
    });
    const confirmedDoctors = new Set(
      consents
        .filter((record) => record.consentType === 'doctor_confirmation' && !record.revokedAt)
        .map((record) => record.doctorProfileId)
        .filter((id): id is string => typeof id === 'string'),
    );

    return {
      organizationId: organization.id,
      providerType: organization.providerType,
      consents,
      agreements,
      templates,
      activeTemplate,
      declarations,
      gaps,
      agreementRequired: Boolean(activeTemplate),
      agreementDeferredNote,
      confirmations: links.map((row) => ({
        id: row.id,
        doctorProfileId: row.doctorProfileId,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      })),
      documents: documents.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        role: document.role,
        mimeType: document.mimeType,
        createdAt: document.createdAt,
      })),
      clinicDoctors: clinicLinks.map((link) => ({
        id: link.doctor.id,
        fullName: link.doctor.fullName,
        status: link.doctor.status,
        confirmed: confirmedDoctors.has(link.doctor.id),
      })),
      linksEnabled: confirmationLinksEnabled,
    };
  }

  async function revokeMatching(
    repos: Repositories,
    organizationId: string,
    match: (record: ConsentRecord) => boolean,
    revokedByUserId: string,
    occurredAt: Date,
  ): Promise<void> {
    const existing = await repos.consents.listByOrganization(organizationId);
    for (const record of existing) {
      if (record.revokedAt || !match(record)) continue;
      await repos.consents.revoke({
        id: record.id,
        revokedAt: occurredAt,
        revokedByUserId,
        reason: 'Superseded by a newer capture',
      });
    }
  }

  function declarationKeyFor(record: ConsentRecord): string | null {
    const key = jsonObject(record.confirmationMeta).declarationKey;
    return typeof key === 'string' ? key : null;
  }

  function assertDoctorBelongs(
    organization: ProviderOrganizationRecord,
    doctorProfileId: string | null,
  ): void {
    if (!doctorProfileId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Choose the doctor whose confirmation is being recorded',
      );
    }
    void organization;
  }

  async function doctorExistsInOrganization(
    organization: ProviderOrganizationRecord,
    doctorProfileId: string,
  ): Promise<boolean> {
    const profile = await repositories.onboarding.findDoctorProfileById(doctorProfileId);
    if (!profile) return false;
    if (profile.organizationId === organization.id) return true;
    if (profile.createdByOrgId === organization.id) return true;
    const links = await repositories.onboarding.listClinicDoctorLinks(organization.id);
    return links.some((link) => link.doctor.id === doctorProfileId);
  }

  async function renderAgreement(
    actor: Actor,
    organizationId: string,
    templateId: string,
  ): Promise<{ fileName: string; body: string; template: AgreementTemplateRecord }> {
    const organization = await loadOrganization(actor, organizationId);
    const template = await repositories.consents.findTemplate(templateId);
    if (!template || template.providerType !== organization.providerType) {
      throw new AppError('NOT_FOUND', 'Agreement template not found');
    }
    const contacts = await repositories.onboarding.listContacts(organization.id);
    const signatory = contacts.find((contact) => contact.role === 'signatory');
    const providerName =
      organization.legalName ?? organization.tradeName ?? `Provider ${organization.code}`;
    const replace = (input: string): string =>
      input
        .replaceAll('{{provider_name}}', providerName)
        .replaceAll('{{provider_code}}', organization.code)
        .replaceAll('{{signatory_name}}', signatory?.name ?? '')
        .replaceAll('{{designation}}', signatory?.designation ?? '');
    const body = replace(template.body);
    const fileName = `${template.name.replace(/\s+/g, '-')}-${template.version}-${organization.code}.pdf`;
    return { fileName, body, template };
  }

  return {
    async get(actor: Actor, organizationId: string): Promise<ConsentOverview> {
      await ensureTemplates(repositories);
      const organization = await loadOrganization(actor, organizationId);
      return overviewFor(repositories, organization);
    },

    async capture(
      actor: Actor,
      organizationId: string,
      input: ConsentCaptureInput,
      ctx: RequestContext,
    ): Promise<ConsentOverview> {
      await ensureTemplates(repositories);
      const organization = await loadOrganization(actor, organizationId);
      assertEditable(actor, organization);
      const documents = await repositories.onboarding.listDocuments(organization.id);
      if (
        input.evidence_document_id &&
        !documents.some((document) => document.id === input.evidence_document_id)
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The evidence document does not belong to this provider',
        );
      }

      const declarations = declarationsFor(organization.providerType);
      const seen = new Set<string>();
      const items = input.items.map((item) => {
        if (item.consent_type === 'declarations') {
          const declaration = declarationByKey(
            organization.providerType,
            item.declaration_key ?? '',
          );
          if (!declaration) {
            throw new AppError('VALIDATION_ERROR', 'Unknown declaration for this provider type');
          }
          const key = `declarations:${declaration.key}`;
          if (seen.has(key)) {
            throw new AppError('VALIDATION_ERROR', 'A declaration was captured twice');
          }
          seen.add(key);
          return { item, declaration };
        }
        const key = item.consent_type;
        if (seen.has(key)) {
          throw new AppError('VALIDATION_ERROR', 'A consent was captured twice');
        }
        seen.add(key);
        return { item, declaration: null };
      });

      const needsDoctor = items.some(({ item }) => item.consent_type === 'doctor_confirmation');
      if (needsDoctor) {
        assertDoctorBelongs(organization, input.doctor_profile_id ?? null);
        if (!(await doctorExistsInOrganization(organization, input.doctor_profile_id as string))) {
          throw new AppError('VALIDATION_ERROR', 'That doctor is not linked to this provider');
        }
      }

      const occurredAt = now();
      return unitOfWork.transaction(async (repos) => {
        for (const { item, declaration } of items) {
          await revokeMatching(
            repos,
            organization.id,
            (record) =>
              record.consentType === item.consent_type &&
              (item.consent_type !== 'declarations' ||
                declarationKeyFor(record) === declaration?.key) &&
              (item.consent_type !== 'doctor_confirmation' ||
                record.doctorProfileId === input.doctor_profile_id),
            actor.userId,
            occurredAt,
          );

          const consent = await repos.consents.createConsent({
            id: newId(),
            organizationId: organization.id,
            doctorProfileId:
              item.consent_type === 'doctor_confirmation'
                ? (input.doctor_profile_id ?? null)
                : null,
            consentType: item.consent_type,
            textVersion: consentTextVersion,
            capturedByUserId: actor.userId,
            capturedAt: occurredAt,
            method: input.method,
            evidenceDocumentId: assertConsentEvidence(input.evidence_document_id),
            confirmationMeta: {
              ...(declaration
                ? { declarationKey: declaration.key, declarationText: declaration.text }
                : {}),
              ...(input.attestation_name ? { attestationName: input.attestation_name } : {}),
              ...(input.note ? { note: input.note } : {}),
              ...(declaration ? {} : { scope: 'published_profile_fields' }),
              declarationCount: declarations.length,
            },
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
          });

          await audit(repos, {
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'provider.consent.captured',
            consentId: consent.id,
            ctx,
            changedFieldKeys: [
              declaration
                ? declaration.key
                : item.consent_type === 'doctor_confirmation'
                  ? 'doctor_confirmation'
                  : item.consent_type,
            ],
          });
          await emitConsentEvent(repos, {
            organizationId: organization.id,
            providerType: organization.providerType,
            consentId: consent.id,
            consentType: consent.consentType,
            method: consent.method,
            actorUserId: actor.userId,
          });
        }

        return overviewFor(repos, organization);
      });
    },

    async acceptAgreement(
      actor: Actor,
      organizationId: string,
      input: AgreementAcceptanceInput,
      ctx: RequestContext,
    ): Promise<ConsentOverview> {
      await ensureTemplates(repositories);
      const organization = await loadOrganization(actor, organizationId);
      assertEditable(actor, organization);
      const template = await repositories.consents.findTemplate(input.template_id);
      if (
        !template ||
        template.status !== 'active' ||
        template.providerType !== organization.providerType
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Choose the active agreement for this provider type',
        );
      }
      if (input.signed_document_id) {
        const documents = await repositories.onboarding.listDocuments(organization.id);
        if (!documents.some((document) => document.id === input.signed_document_id)) {
          throw new AppError(
            'VALIDATION_ERROR',
            'The signed agreement does not belong to this provider',
          );
        }
      }

      const occurredAt = now();
      const signedOn = new Date(`${input.signed_on}T00:00:00Z`);
      return unitOfWork.transaction(async (repos) => {
        await revokeMatching(
          repos,
          organization.id,
          (record) => record.consentType === 'agreement',
          actor.userId,
          occurredAt,
        );

        const acceptance = await repos.consents.createAgreement({
          id: newId(),
          organizationId: organization.id,
          templateId: template.id,
          method: input.method,
          signedOn,
          place: input.place,
          signatoryName: input.signatory_name,
          signatoryDesignation: input.signatory_designation,
          signedDocumentId: input.signed_document_id ?? null,
          stampReference: input.stamp_reference ?? null,
          witnesses: input.witnesses ?? [],
          recordedByUserId: actor.userId,
          revokedAt: null,
        });

        const consent = await repos.consents.createConsent({
          id: newId(),
          organizationId: organization.id,
          doctorProfileId: null,
          consentType: 'agreement',
          textVersion: `${template.name} ${template.version}`,
          capturedByUserId: actor.userId,
          capturedAt: occurredAt,
          method: input.method,
          evidenceDocumentId: input.signed_document_id ?? null,
          confirmationMeta: {
            templateId: template.id,
            templateVersion: template.version,
            templateBodyHash: template.bodyHash,
            acceptanceId: acceptance.id,
            signatoryName: input.signatory_name,
            place: input.place,
            signedOn: input.signed_on,
          },
          revokedAt: null,
          revokedByUserId: null,
          revokeReason: null,
        });

        await audit(repos, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'provider.agreement.accepted',
          consentId: consent.id,
          ctx,
          changedFieldKeys: ['agreement'],
        });
        await emitConsentEvent(repos, {
          organizationId: organization.id,
          providerType: organization.providerType,
          consentId: consent.id,
          consentType: consent.consentType,
          method: consent.method,
          actorUserId: actor.userId,
        });

        return overviewFor(repos, organization);
      });
    },

    async revoke(
      actor: Actor,
      organizationId: string,
      consentId: string,
      reason: string,
      ctx: RequestContext,
    ): Promise<ConsentOverview> {
      const organization = await loadOrganization(actor, organizationId);
      assertEditable(actor, organization);
      const consent = await repositories.consents.findById(consentId);
      if (!consent || consent.organizationId !== organization.id) {
        throw new AppError('NOT_FOUND', 'Consent not found');
      }
      if (consent.revokedAt) {
        throw new AppError('CONFLICT', 'This consent was already revoked');
      }

      const occurredAt = now();
      const publicationOff = consent.consentType === 'publication';
      return unitOfWork.transaction(async (repos) => {
        const revoked = await repos.consents.revoke({
          id: consent.id,
          revokedAt: occurredAt,
          revokedByUserId: actor.userId,
          reason,
        });
        if (!revoked) {
          throw new AppError('CONFLICT', 'This consent was already revoked');
        }

        if (publicationOff) {
          const updated = await repos.onboarding.updateOrganization({
            id: organization.id,
            expectedVersion: organization.version,
            columns: {},
            publicationConsents: {
              ...organization.publicationConsents,
              consent_publish_photo: false,
              public_fields: [],
              publication_revoked_at: occurredAt.toISOString(),
            },
          });
          if (!updated) {
            throw new AppError('VERSION_CONFLICT', 'This provider was changed by someone else', {
              expectedVersion: organization.version,
            });
          }
        }

        await audit(repos, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'provider.consent.revoked',
          consentId: consent.id,
          ctx,
          reason,
          changedFieldKeys: ['revoked_at'],
        });
        await emitConsentEvent(repos, {
          organizationId: organization.id,
          providerType: organization.providerType,
          consentId: consent.id,
          consentType: consent.consentType,
          method: consent.method,
          actorUserId: actor.userId,
          ...(publicationOff ? { publicationPermissionOff: true } : {}),
        });

        const refreshed = await repos.onboarding.findOrganizationById(organization.id, {
          includeDeleted: true,
        });
        return overviewFor(repos, refreshed ?? organization);
      });
    },

    /**
     * Resolves a consent's evidence file for download. Every access is audited,
     * as the field spec requires for signed forms and declarations.
     */
    async evidence(
      actor: Actor,
      organizationId: string,
      consentId: string,
      ctx: RequestContext,
    ): Promise<{ fileName: string; storageKey: string | null; documentId: string }> {
      const organization = await loadOrganization(actor, organizationId);
      const consent = await repositories.consents.findById(consentId);
      if (!consent || consent.organizationId !== organization.id) {
        throw new AppError('NOT_FOUND', 'Consent not found');
      }
      if (!consent.evidenceDocumentId) {
        throw new AppError('NOT_FOUND', 'No evidence file was uploaded for this consent');
      }
      const documents = await repositories.onboarding.listDocuments(organization.id);
      const document = documents.find((row) => row.id === consent.evidenceDocumentId);
      if (!document) throw new AppError('NOT_FOUND', 'Evidence file not found');

      await repositories.audits.append({
        id: newId(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'provider.consent.evidence.downloaded',
        entityType: 'consent',
        entityId: consent.id,
        requestId: ctx.requestId,
        changedFieldKeys: [],
        fromStatus: null,
        toStatus: null,
        reason: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now(),
      });

      return {
        fileName: document.fileName,
        storageKey: document.storageKey,
        documentId: document.id,
      };
    },

    /** The signed agreement copy, audited like consent evidence. */
    async agreementEvidence(
      actor: Actor,
      organizationId: string,
      acceptanceId: string,
      ctx: RequestContext,
    ): Promise<{ fileName: string; storageKey: string | null }> {
      const organization = await loadOrganization(actor, organizationId);
      const agreements = await repositories.consents.listAgreements(organization.id);
      const agreement = agreements.find((row) => row.id === acceptanceId);
      if (!agreement) throw new AppError('NOT_FOUND', 'Agreement acceptance not found');
      if (!agreement.signedDocumentId) {
        throw new AppError('NOT_FOUND', 'No signed copy was uploaded for this agreement');
      }
      const documents = await repositories.onboarding.listDocuments(organization.id);
      const document = documents.find((row) => row.id === agreement.signedDocumentId);
      if (!document) throw new AppError('NOT_FOUND', 'Signed agreement not found');

      await repositories.audits.append({
        id: newId(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'provider.agreement.evidence.downloaded',
        entityType: 'agreement_acceptance',
        entityId: agreement.id,
        requestId: ctx.requestId,
        changedFieldKeys: [],
        fromStatus: null,
        toStatus: null,
        reason: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now(),
      });

      return { fileName: document.fileName, storageKey: document.storageKey };
    },

    async renderAgreement(actor: Actor, organizationId: string, templateId: string) {
      await ensureTemplates(repositories);
      return renderAgreement(actor, organizationId, templateId);
    },

    async createConfirmationRequest(
      actor: Actor,
      organizationId: string,
      input: ConfirmationRequestInput,
      ctx: RequestContext,
    ): Promise<{ url: string; expiresAt: Date; token: string }> {
      if (!confirmationLinksEnabled) {
        throw new AppError(
          'FORBIDDEN',
          'Public confirmation links are turned off. Use in-person attestation or a signed form.',
        );
      }
      const organization = await loadOrganization(actor, organizationId);
      assertEditable(actor, organization);
      if (input.doctor_profile_id) {
        if (!(await doctorExistsInOrganization(organization, input.doctor_profile_id))) {
          throw new AppError('VALIDATION_ERROR', 'That doctor is not linked to this provider');
        }
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(
        now().getTime() + (input.expires_in_hours ?? LINK_TTL_HOURS) * 60 * 60 * 1000,
      );
      const request = await repositories.consents.createConfirmationRequest({
        id: newId(),
        organizationId: organization.id,
        doctorProfileId: input.doctor_profile_id ?? null,
        tokenHash: sha256(token),
        expiresAt,
        usedAt: null,
        revokedAt: null,
        confirmationMeta: {},
        createdByUserId: actor.userId,
      });

      await repositories.audits.append({
        id: newId(),
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'provider.confirmation.link_created',
        entityType: 'confirmation_request',
        entityId: request.id,
        requestId: ctx.requestId,
        changedFieldKeys: [],
        fromStatus: null,
        toStatus: null,
        reason: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        createdAt: now(),
      });

      return { url: `${appUrl.replace(/\/$/, '')}/confirm/${token}`, expiresAt, token };
    },

    async getConfirmation(token: string): Promise<ConfirmationView> {
      const request = await repositories.consents.findConfirmationRequestByTokenHash(sha256(token));
      if (!request) throw new AppError('NOT_FOUND', 'This confirmation link is not valid');
      const organization = await repositories.onboarding.findOrganizationById(
        request.organizationId,
        { includeDeleted: true },
      );
      if (!organization || organization.deletedAt) {
        throw new AppError('NOT_FOUND', 'This confirmation link is not valid');
      }
      const state = request.revokedAt
        ? 'revoked'
        : request.usedAt
          ? 'used'
          : request.expiresAt.getTime() <= now().getTime()
            ? 'expired'
            : 'open';

      return {
        state,
        organizationName:
          organization.legalName ?? organization.tradeName ?? `Provider ${organization.code}`,
        providerType: organization.providerType,
        providerCode: organization.code,
        expiresAt: request.expiresAt,
        doctorProfileId: request.doctorProfileId,
        declarations: declarationsFor(organization.providerType),
        hasDoctor: Boolean(request.doctorProfileId),
      };
    },

    async requestOtp(
      token: string,
      mobile: string | undefined,
    ): Promise<{ maskedPhone: string; expiresAt: Date }> {
      const request = await repositories.consents.findConfirmationRequestByTokenHash(sha256(token));
      if (!request) throw new AppError('NOT_FOUND', 'This confirmation link is not valid');
      if (request.usedAt || request.revokedAt) {
        throw new AppError('CONFLICT', 'This confirmation link has already been used');
      }
      if (request.expiresAt.getTime() <= now().getTime()) {
        throw new AppError('CONFLICT', 'This confirmation link has expired');
      }
      const organization = await repositories.onboarding.findOrganizationById(
        request.organizationId,
      );
      if (!organization) throw new AppError('NOT_FOUND', 'This confirmation link is not valid');

      let phone = mobile ?? organization.mobile ?? null;
      if (!phone && request.doctorProfileId) {
        const doctor = await repositories.onboarding.findDoctorProfileById(request.doctorProfileId);
        phone = doctor?.mobile ?? null;
      }
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', 'Add a mobile number to send a one-time code');
      }

      const challenge = await smsProvider.requestOtp({ phone, now: now() });
      await repositories.consents.updateConfirmationRequest(request.id, {
        confirmationMeta: {
          ...request.confirmationMeta,
          otpCodeHash: challenge.codeHash,
          otpPhone: challenge.maskedPhone,
          otpExpiresAt: challenge.expiresAt.toISOString(),
          otpAttemptsLeft: challenge.attemptsLeft,
        },
      });
      return { maskedPhone: challenge.maskedPhone, expiresAt: challenge.expiresAt };
    },

    async confirm(
      token: string,
      input: PublicConfirmationInput,
      ctx: RequestContext,
    ): Promise<{ confirmedAt: Date; recorded: number }> {
      const request = await repositories.consents.findConfirmationRequestByTokenHash(sha256(token));
      if (!request) throw new AppError('NOT_FOUND', 'This confirmation link is not valid');
      if (request.usedAt)
        throw new AppError('CONFLICT', 'This confirmation link has already been used');
      if (request.revokedAt) throw new AppError('CONFLICT', 'This confirmation link was revoked');
      if (request.expiresAt.getTime() <= now().getTime()) {
        throw new AppError('CONFLICT', 'This confirmation link has expired');
      }
      const organization = await repositories.onboarding.findOrganizationById(
        request.organizationId,
        { includeDeleted: true },
      );
      if (!organization || organization.deletedAt) {
        throw new AppError('NOT_FOUND', 'This confirmation link is not valid');
      }

      if (input.method === 'OTP') {
        const meta = request.confirmationMeta;
        const hash = typeof meta.otpCodeHash === 'string' ? meta.otpCodeHash : null;
        const expiresAt = typeof meta.otpExpiresAt === 'string' ? meta.otpExpiresAt : null;
        const attempts = typeof meta.otpAttemptsLeft === 'number' ? meta.otpAttemptsLeft : 0;
        if (!hash || !input.otp_code) {
          throw new AppError('VALIDATION_ERROR', 'Request a one-time code first');
        }
        if (expiresAt && new Date(expiresAt).getTime() <= now().getTime()) {
          throw new AppError('VALIDATION_ERROR', 'The one-time code has expired');
        }
        if (attempts <= 0) {
          throw new AppError('VALIDATION_ERROR', 'Too many attempts. Request a new code.');
        }
        if (hashOtp(input.otp_code) !== hash) {
          await repositories.consents.updateConfirmationRequest(request.id, {
            confirmationMeta: { ...meta, otpAttemptsLeft: attempts - 1 },
          });
          throw new AppError('VALIDATION_ERROR', 'That one-time code is not correct');
        }
      }

      const declarations = declarationsFor(organization.providerType);
      const provided = new Set(input.declaration_keys);
      const missing = declarations.filter((declaration) => !provided.has(declaration.key));
      if (missing.length > 0) {
        throw new AppError('VALIDATION_ERROR', 'Tick every declaration before confirming', {
          missing: missing.map((declaration) => declaration.key),
        });
      }

      const occurredAt = now();
      const recordedAt = occurredAt;
      return unitOfWork.transaction(async (repos) => {
        const create = async (
          consentType:
            'publication' | 'data_privacy_notice' | 'declarations' | 'doctor_confirmation',
          meta: Record<string, unknown>,
        ) =>
          repos.consents.createConsent({
            id: newId(),
            organizationId: organization.id,
            doctorProfileId:
              consentType === 'doctor_confirmation' ? (request.doctorProfileId ?? null) : null,
            consentType,
            textVersion: consentTextVersion,
            capturedByUserId: null,
            capturedAt: recordedAt,
            method: input.method,
            evidenceDocumentId: null,
            confirmationMeta: {
              ...meta,
              confirmedByName: input.full_name,
              ...(input.designation ? { confirmedByDesignation: input.designation } : {}),
              confirmationRequestId: request.id,
              ipAddress: ctx.ipAddress,
            },
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
          });

        const publication = await create('publication', { scope: 'published_profile_fields' });
        await create('data_privacy_notice', {});
        for (const declaration of declarations) {
          await create('declarations', {
            declarationKey: declaration.key,
            declarationText: declaration.text,
          });
        }
        if (request.doctorProfileId) {
          await create('doctor_confirmation', {});
          await repos.consents.markDoctorConfirmed(request.doctorProfileId, recordedAt);
        }

        await repos.consents.updateConfirmationRequest(request.id, {
          usedAt: recordedAt,
          confirmationMeta: { ...request.confirmationMeta, confirmedByName: input.full_name },
        });

        await audit(repos, {
          actorUserId: null,
          actorRole: null,
          action: 'provider.consent.confirmed',
          consentId: publication.id,
          ctx,
          changedFieldKeys: ['publication', 'data_privacy_notice', 'declarations'],
        });
        await emitConsentEvent(repos, {
          organizationId: organization.id,
          providerType: organization.providerType,
          consentId: publication.id,
          consentType: 'publication',
          method: input.method,
          actorUserId: null,
        });

        return {
          confirmedAt: recordedAt,
          recorded: 3 + declarations.length + (request.doctorProfileId ? 1 : 0),
        };
      });
    },

    /** Used by the public page for the provider's contact hint. */
    async confirmationContact(token: string): Promise<{ maskedPhone: string | null }> {
      const request = await repositories.consents.findConfirmationRequestByTokenHash(sha256(token));
      if (!request) return { maskedPhone: null };
      const phone = request.confirmationMeta.otpPhone;
      return { maskedPhone: typeof phone === 'string' ? phone : null };
    },
  };
}
