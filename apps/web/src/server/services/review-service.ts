import {
  AppError,
  can,
  doctorVerificationItems,
  formSectionsFor,
  outboxEventVersions,
  providerVerificationPayloadSchema,
  requiredVerificationItemsFor,
  reviewSlaState,
  suspensionScopeLabels,
  type Actor,
  type ProviderOrganizationRecord,
  type ReviewChecklistProgress,
  type ReviewDecisionInput,
  type ReviewDetail,
  type ReviewQueueQuery,
  type ReviewQueueResult,
  type ReviewCommentInput,
  type ReviewSettingsInput,
  type ReviewVerificationDto,
  type ReviewVerificationUpdate,
  type SuspensionScope,
} from '@curenear/shared';
import type { EmailService } from '@/server/email';
import type { RequestContext } from './service-deps';
import type { ServiceDeps } from './service-deps';
import type { createProviderOnboardingService } from './provider-onboarding-service';

/**
 * Admin review workflow (field spec section 10).
 *
 * Decisions go through the Prompt 7 state machine (never a direct status
 * write), which also writes audit and outbox events. Approval is blocked while
 * any required checklist item is unverified. Review comments live per section
 * and are visible to the onboarding staff through the staff workspace.
 */

function assertReviewer(actor: Actor): void {
  if (!can({ id: actor.userId, role: actor.role }, 'provider.review')) {
    throw new AppError('FORBIDDEN', 'Only administrators can review providers');
  }
}

function assertVerifier(actor: Actor): void {
  if (!can({ id: actor.userId, role: actor.role }, 'provider.verify')) {
    throw new AppError('FORBIDDEN', 'Only administrators can verify checklist items');
  }
}

function checklistOf(verifications: ReviewVerificationDto[]): ReviewChecklistProgress {
  const count = (status: ReviewVerificationDto['status']) =>
    verifications.filter((row) => row.status === status).length;
  const required = verifications.filter((row) => row.required).length;
  const blocking = verifications.filter(
    (row) => row.required && row.status !== 'VERIFIED' && row.status !== 'NOT_APPLICABLE',
  ).length;
  return {
    total: verifications.length,
    required,
    verified: count('VERIFIED'),
    notApplicable: count('NOT_APPLICABLE'),
    pending: count('PENDING'),
    rejected: count('REJECTED'),
    expired: count('EXPIRED'),
    blocking,
  };
}

function date(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function line(
  label: string,
  value: string | number | null | undefined,
): {
  key: string;
  label: string;
  value: string;
} {
  return {
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label,
    value: value === null || value === undefined || value === '' ? '—' : String(value),
  };
}

export function createReviewService(
  deps: Pick<ServiceDeps, 'repositories' | 'unitOfWork' | 'now' | 'newId'> & {
    onboarding: ReturnType<typeof createProviderOnboardingService>;
    email: EmailService;
  },
) {
  const { repositories, unitOfWork, now, newId, onboarding, email } = deps;

  async function organization(id: string): Promise<ProviderOrganizationRecord> {
    const row = await repositories.onboarding.findOrganizationById(id);
    if (!row) throw new AppError('NOT_FOUND', 'Provider not found');
    return row;
  }

  async function notifyOwner(
    row: ProviderOrganizationRecord,
    subject: string,
    text: string,
  ): Promise<void> {
    const staff = await repositories.staff.findById(row.createdByUserId);
    if (!staff?.email) return;
    await email.send({ to: staff.email, subject, text });
  }

  function assertReviewableStatus(row: ProviderOrganizationRecord): void {
    if (row.status !== 'SUBMITTED' && row.status !== 'UNDER_REVIEW') {
      throw new AppError('INVALID_TRANSITION', 'This provider is not in the review queue');
    }
  }

  /** SUBMITTED → UNDER_REVIEW is the first state-machine step of every decision. */
  async function moveToUnderReview(
    actor: Actor,
    row: ProviderOrganizationRecord,
    ctx: RequestContext,
  ): Promise<ProviderOrganizationRecord> {
    if (row.status === 'UNDER_REVIEW') return row;
    await onboarding.transitionStatus(
      actor,
      row.id,
      { to: 'UNDER_REVIEW', version: row.version },
      ctx,
    );
    return organization(row.id);
  }

  async function validateScope(
    row: ProviderOrganizationRecord,
    scope: SuspensionScope,
    scopeRefId: string | undefined,
  ): Promise<{ scopeRefId: string | null; scopeLabel: string }> {
    if (scope === 'WHOLE_PROFILE') {
      return { scopeRefId: null, scopeLabel: suspensionScopeLabels.WHOLE_PROFILE };
    }
    if (!scopeRefId) {
      throw new AppError('VALIDATION_ERROR', 'Choose what this suspension covers', {
        issues: [{ path: 'scope_ref_id', message: 'A scope reference is required' }],
      });
    }
    if (scope === 'LOCATION') {
      const location = (await repositories.onboarding.listLocations(row.id)).find(
        (entry) => entry.id === scopeRefId,
      );
      if (!location) throw new AppError('NOT_FOUND', 'Location not found for this provider');
      return { scopeRefId, scopeLabel: location.name };
    }
    const pin = (await repositories.onboarding.listServicePins(row.id)).find(
      (entry) => entry.id === scopeRefId,
    );
    if (!pin) throw new AppError('NOT_FOUND', 'Service category not found for this provider');
    return { scopeRefId, scopeLabel: pin.serviceKind };
  }

  return {
    async queue(actor: Actor, query: ReviewQueueQuery): Promise<ReviewQueueResult> {
      assertReviewer(actor);
      const settings = await repositories.reviews.settings();
      const { rows, total } = await repositories.reviews.queue(
        {
          providerTypes: query.providerType ?? [],
          pin: query.pin ?? null,
          staffUserId: query.staff ?? null,
          assignedToUserId: query.assignedToMe ? actor.userId : null,
        },
        query.page,
        query.pageSize,
      );
      const at = now();
      return {
        rows: rows.map((row) => {
          const ageHours = row.submittedAt
            ? Math.max(0, Math.round((at.getTime() - row.submittedAt.getTime()) / 3_600_000))
            : null;
          return {
            id: row.id,
            code: row.code,
            legalName: row.legalName,
            providerType: row.providerType,
            status: row.status,
            pinCode: row.primaryPinCode,
            submittedAt: date(row.submittedAt),
            ageHours,
            sla: row.submittedAt ? reviewSlaState(row.submittedAt, at, settings) : 'ok',
            staff: row.staff,
            assignedTo: row.assignedTo,
            checklist: row.checklist,
          };
        }),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
        settings,
      };
    },

    async assignToMe(actor: Actor, id: string): Promise<{ assigned: true }> {
      assertReviewer(actor);
      const row = await organization(id);
      assertReviewableStatus(row);
      await repositories.reviews.assign(id, actor.userId, actor.userId);
      return { assigned: true };
    },

    async detail(actor: Actor, id: string): Promise<ReviewDetail> {
      assertReviewer(actor);
      const row = await organization(id);
      const [
        staff,
        assignment,
        initialVerifications,
        comments,
        documents,
        locations,
        contacts,
        licences,
        insurance,
        servicePins,
        doctorProfile,
        clinicDoctors,
      ] = await Promise.all([
        repositories.staff.findById(row.createdByUserId),
        repositories.reviews.assignment(id),
        repositories.reviews.verifications(id),
        repositories.reviews.comments(id),
        repositories.onboarding.listDocuments(id),
        repositories.onboarding.listLocations(id),
        repositories.onboarding.listContacts(id),
        repositories.onboarding.listLicences(id),
        repositories.onboarding.listInsurance(id),
        repositories.onboarding.listServicePins(id),
        repositories.onboarding.findDoctorProfileByOrganizationId(id),
        repositories.onboarding.listClinicDoctorLinks(id),
      ]);

      // Applications submitted before the checklist tables existed (or imported
      // from elsewhere) get their items generated on first open, so the review
      // screen never claims approval readiness with an empty checklist.
      let verifications = initialVerifications;
      if (verifications.length === 0) {
        await repositories.reviews.seed(id, requiredVerificationItemsFor(row.providerType));
        if (row.providerType === 'clinic') {
          const links = await repositories.onboarding.listClinicDoctorLinks(id);
          for (const link of links) {
            await repositories.reviews.seedDoctor(link.doctor.id, doctorVerificationItems());
          }
        }
        verifications = await repositories.reviews.verifications(id);
      }

      const checklist = checklistOf(verifications);
      const sections: ReviewDetail['sections'] = [
        {
          key: 'legal_entity',
          title: 'Legal entity',
          fields: [
            line('Legal name', row.legalName),
            line('Trade name', row.tradeName),
            line('Provider code', row.code),
            line('Registration number', row.registrationNumber),
            line('Email', row.email),
            line('Mobile', row.mobile),
            line('Website', row.website),
          ],
        },
        {
          key: 'registered_office',
          title: 'Registered office',
          fields: [
            line('Primary PIN', row.primaryPinCode),
            line(
              'Locations',
              locations.length === 0
                ? '—'
                : locations
                    .map(
                      (entry) =>
                        `${entry.name}, ${entry.city} ${entry.pinCode}${entry.isPrimary ? ' (primary)' : ''}`,
                    )
                    .join('; '),
            ),
          ],
        },
        {
          key: 'signatory',
          title: 'Signatory and contacts',
          fields:
            contacts.length === 0
              ? [line('Contacts', '—')]
              : contacts.map((entry, index) =>
                  line(
                    `${entry.role} ${index + 1}`,
                    `${entry.name}${entry.designation ? ` (${entry.designation})` : ''} · ${entry.phone}`,
                  ),
                ),
        },
        {
          key: 'insurance',
          title: 'Insurance',
          fields:
            insurance.length === 0
              ? [line('Policies', '—')]
              : insurance.map((entry) =>
                  line(`${entry.insurer}`, `${entry.policyNo} · valid to ${entry.validTo ?? '—'}`),
                ),
        },
        {
          key: 'licences',
          title: 'Licences and registrations',
          fields:
            licences.length === 0
              ? [line('Licences', '—')]
              : licences.map((entry) =>
                  line(
                    String(entry.details.role ?? 'Licence'),
                    `${entry.number}${entry.authority ? ` · ${entry.authority}` : ''} · valid to ${entry.validTo ? entry.validTo.toISOString().slice(0, 10) : '—'}`,
                  ),
                ),
        },
        {
          key: 'service_area',
          title: 'Service area',
          fields: [
            line(
              'Service PINs',
              servicePins.length === 0
                ? '—'
                : servicePins.map((entry) => `${entry.pinCode} (${entry.serviceKind})`).join(', '),
            ),
          ],
        },
      ];

      if (row.providerType === 'doctor' && doctorProfile) {
        sections.push({
          key: 'doctor_identity',
          title: 'Doctor identity',
          fields: [
            line('Doctor', doctorProfile.fullName),
            line('Registration', doctorProfile.registrationNo),
            line('Council', doctorProfile.councilName),
            line('System of medicine', doctorProfile.systemOfMedicine),
          ],
        });
        sections.push({
          key: 'doctor_qualifications',
          title: 'Doctor qualifications',
          fields:
            doctorProfile.qualifications.length === 0
              ? [line('Qualifications', '—')]
              : doctorProfile.qualifications.map((entry, index) =>
                  line(
                    `Qualification ${index + 1}`,
                    typeof entry === 'object' && entry
                      ? String(
                          (entry as Record<string, unknown>).qualification ??
                            (entry as Record<string, unknown>).degree ??
                            JSON.stringify(entry),
                        )
                      : String(entry),
                  ),
                ),
        });
      }

      if (row.providerType === 'clinic') {
        sections.push({
          key: 'clinic_doctors',
          title: 'Clinic doctors',
          fields:
            clinicDoctors.length === 0
              ? [line('Doctors', '—')]
              : clinicDoctors.map((entry) =>
                  line(
                    entry.doctor.fullName,
                    `${entry.doctor.registrationNo}${entry.doctor.doctorConfirmedAt ? ' · confirmed' : ' · awaiting confirmation'}`,
                  ),
                ),
        });
      }

      const suspension = await repositories.reviews.lastSuspension(id);

      return {
        organization: {
          id: row.id,
          code: row.code,
          providerType: row.providerType,
          status: row.status,
          legalName: row.legalName,
          tradeName: row.tradeName,
          primaryPinCode: row.primaryPinCode,
          submittedAt: date(row.submittedAt),
          approvedAt: date(row.approvedAt),
          version: row.version,
          createdByUserId: row.createdByUserId,
        },
        staff: staff ? { id: staff.id, name: staff.name, email: staff.email } : null,
        assignment: assignment
          ? {
              reviewerUserId: assignment.reviewerUserId,
              reviewerName: assignment.reviewerName,
              assignedAt: assignment.assignedAt.toISOString(),
            }
          : null,
        verifications,
        comments,
        checklist,
        canApprove:
          checklist.total > 0 &&
          checklist.blocking === 0 &&
          (row.status === 'SUBMITTED' || row.status === 'UNDER_REVIEW'),
        documents: documents.map((document) => ({
          id: document.id,
          fileName: document.fileName,
          documentTypeName: document.role ?? 'Document',
          role: document.role,
          status: 'UPLOADED',
          url: `/api/v1/providers/${id}/documents/${document.id}`,
        })),
        sections,
        canSuspend: row.status === 'APPROVED',
        canReinstate: row.status === 'SUSPENDED',
        suspension,
        scopeOptions: {
          locations: locations.map((entry) => ({
            id: entry.id,
            label: `${entry.name}, ${entry.city}`,
          })),
          services: servicePins.map((entry) => ({
            id: entry.id,
            label: entry.serviceKind,
          })),
        },
      };
    },

    async updateVerification(
      actor: Actor,
      id: string,
      item: string,
      input: ReviewVerificationUpdate,
      ctx: RequestContext,
    ): Promise<ReviewVerificationDto> {
      assertVerifier(actor);
      await organization(id);
      const at = now();
      try {
        const result = await unitOfWork.transaction(async (repos) => {
          const updated = await repos.reviews.updateVerification(id, item, input, actor.userId, at);
          await repos.audits.append({
            id: newId(),
            actorUserId: actor.userId,
            actorRole: actor.role,
            action: 'provider.verification.updated',
            entityType: 'provider_organization',
            entityId: id,
            requestId: ctx.requestId,
            changedFieldKeys: [item],
            fromStatus: null,
            toStatus: null,
            reason: input.reason ?? null,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            createdAt: at,
          });
          const payload = providerVerificationPayloadSchema.parse({
            providerId: id,
            item,
            status: input.status,
            actorUserId: actor.userId,
          });
          await repos.outbox.append({
            id: newId(),
            eventType: 'provider.verification.updated',
            eventVersion: outboxEventVersions['provider.verification.updated'],
            aggregateType: 'provider_organization',
            aggregateId: id,
            payload,
            occurredAt: at,
            dedupeKey: `${id}:verification:${item}:${input.status}:${at.toISOString()}`,
          });
          return updated;
        });
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === 'VERIFICATION_NOT_FOUND') {
          throw new AppError('NOT_FOUND', 'Verification item not found');
        }
        throw error;
      }
    },

    async addComment(
      actor: Actor,
      id: string,
      input: ReviewCommentInput,
      ctx: RequestContext,
    ): Promise<{ id: string }> {
      assertReviewer(actor);
      await organization(id);
      const at = now();
      const commentId = newId();
      await unitOfWork.transaction(async (repos) => {
        await repos.reviews.addComment({
          id: commentId,
          organizationId: id,
          sectionKey: input.section_key,
          authorUserId: actor.userId,
          authorRole: actor.role,
          body: input.body,
          at,
        });
        await repos.audits.append({
          id: newId(),
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'provider.review.comment.added',
          entityType: 'provider_organization',
          entityId: id,
          requestId: ctx.requestId,
          changedFieldKeys: [input.section_key],
          fromStatus: null,
          toStatus: null,
          reason: input.body.slice(0, 1000),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          createdAt: at,
        });
      });
      return { id: commentId };
    },

    async decide(
      actor: Actor,
      id: string,
      input: ReviewDecisionInput,
      ctx: RequestContext,
    ): Promise<{ status: ProviderOrganizationRecord['status'] }> {
      assertReviewer(actor);
      const row = await organization(id);

      if (input.decision === 'approve') {
        assertReviewableStatus(row);
        const existing = await repositories.reviews.verifications(id);
        if (existing.length === 0) {
          await repositories.reviews.seed(id, requiredVerificationItemsFor(row.providerType));
          if (row.providerType === 'clinic') {
            const links = await repositories.onboarding.listClinicDoctorLinks(id);
            for (const link of links) {
              await repositories.reviews.seedDoctor(link.doctor.id, doctorVerificationItems());
            }
          }
        }
        const verifications =
          existing.length === 0 ? await repositories.reviews.verifications(id) : existing;
        const blocking = verifications.filter(
          (item) => item.required && item.status !== 'VERIFIED' && item.status !== 'NOT_APPLICABLE',
        );
        if (blocking.length > 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            'Verify every required checklist item before approving',
            {
              blocking: blocking.map((item) => ({
                item: item.item,
                label: item.label,
                status: item.status,
              })),
            },
          );
        }

        const reviewing = await moveToUnderReview(actor, row, ctx);
        await onboarding.transitionStatus(
          actor,
          id,
          { to: 'APPROVED', version: reviewing.version },
          ctx,
        );
        await notifyOwner(
          row,
          'Your provider application was approved',
          `Provider ${row.code} was approved.`,
        );
        return { status: 'APPROVED' };
      }

      if (input.decision === 'request_changes') {
        assertReviewableStatus(row);
        const validSections = new Set([
          ...formSectionsFor(row.providerType).map((section) => section.key),
          'legal_entity',
          'registered_office',
          'signatory',
          'insurance',
          'licences',
          'service_area',
          'doctor_identity',
          'doctor_qualifications',
          'clinic_doctors',
          'declarations',
        ]);
        const unknown = input.sections.filter((section) => !validSections.has(section));
        if (unknown.length > 0) {
          throw new AppError('VALIDATION_ERROR', 'Unknown section in the change request', {
            sections: unknown,
          });
        }
        const reviewing = await moveToUnderReview(actor, row, ctx);
        await onboarding.transitionStatus(
          actor,
          id,
          {
            to: 'CHANGES_REQUESTED',
            version: reviewing.version,
            reason: input.comment,
          },
          ctx,
          { flaggedSections: input.sections },
        );
        // One thread per flagged section so the staff member sees the note where
        // the fix belongs.
        for (const sectionKey of [...new Set(input.sections)]) {
          await repositories.reviews.addComment({
            id: newId(),
            organizationId: id,
            sectionKey,
            authorUserId: actor.userId,
            authorRole: actor.role,
            body: input.comment,
            at: now(),
          });
        }
        await notifyOwner(
          row,
          'Changes requested on your provider application',
          `Provider ${row.code} needs changes: ${input.comment}`,
        );
        return { status: 'CHANGES_REQUESTED' };
      }

      if (input.decision === 'reject') {
        assertReviewableStatus(row);
        const reviewing = await moveToUnderReview(actor, row, ctx);
        await onboarding.transitionStatus(
          actor,
          id,
          { to: 'REJECTED', version: reviewing.version, reason: input.reason },
          ctx,
        );
        await notifyOwner(
          row,
          'Your provider application was rejected',
          `Provider ${row.code} was rejected: ${input.reason}`,
        );
        return { status: 'REJECTED' };
      }

      if (input.decision === 'suspend') {
        if (row.status !== 'APPROVED') {
          throw new AppError('INVALID_TRANSITION', 'Only an approved provider can be suspended');
        }
        const scope = await validateScope(row, input.scope, input.scope_ref_id);
        await onboarding.transitionStatus(
          actor,
          id,
          { to: 'SUSPENDED', version: row.version, reason: input.reason },
          ctx,
          {
            scope: input.scope,
            scopeRefId: scope.scopeRefId,
            scopeLabel: scope.scopeLabel,
          },
        );
        await notifyOwner(
          row,
          'Your provider profile was suspended',
          `Provider ${row.code} was suspended (${scope.scopeLabel}): ${input.reason}`,
        );
        return { status: 'SUSPENDED' };
      }

      if (row.status !== 'SUSPENDED') {
        throw new AppError('INVALID_TRANSITION', 'Only a suspended provider can be reinstated');
      }
      let scope: { scopeRefId: string | null; scopeLabel: string | null } = {
        scopeRefId: null,
        scopeLabel: null,
      };
      if (input.scope) {
        const validated = await validateScope(row, input.scope, input.scope_ref_id);
        scope = { scopeRefId: validated.scopeRefId, scopeLabel: validated.scopeLabel };
      }
      await onboarding.transitionStatus(
        actor,
        id,
        { to: 'APPROVED', version: row.version, reason: input.reason },
        ctx,
        {
          scope: input.scope ?? null,
          scopeRefId: scope.scopeRefId,
          scopeLabel: scope.scopeLabel,
        },
      );
      await notifyOwner(
        row,
        'Your provider profile was reinstated',
        `Provider ${row.code} was reinstated: ${input.reason}`,
      );
      return { status: 'APPROVED' };
    },

    async settings(actor: Actor) {
      assertReviewer(actor);
      const row = await repositories.reviews.settings();
      return {
        warnHours: row.warnHours,
        breachHours: row.breachHours,
        updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      };
    },

    async saveSettings(actor: Actor, input: ReviewSettingsInput, ctx: RequestContext) {
      assertReviewer(actor);
      const at = now();
      const saved = await unitOfWork.transaction(async (repos) => {
        const settings = await repos.reviews.saveSettings(
          { warnHours: input.warn_hours, breachHours: input.breach_hours },
          actor.userId,
        );
        await repos.audits.append({
          id: newId(),
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'review.settings.updated',
          entityType: 'review_settings',
          entityId: 'default',
          requestId: ctx.requestId,
          changedFieldKeys: ['sla_warn_hours', 'sla_breach_hours'],
          fromStatus: null,
          toStatus: null,
          reason: null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          createdAt: at,
        });
        return settings;
      });
      return {
        warnHours: saved.warnHours,
        breachHours: saved.breachHours,
        updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : null,
      };
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
