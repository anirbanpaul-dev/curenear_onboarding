import { z } from 'zod';
import { providerTypes, type ProviderType } from './enums';
import { documentRequirementsFor } from './fields/registry';
import type { OrganizationStatus } from './provider-lifecycle';

/**
 * Admin review workflow (field spec section 10).
 *
 * Required verification items are derived from the field registry's document
 * requirements: an item whose document is required by the registry is required
 * for approval; conditional/optional documents become optional checks. The
 * static catalogue supplies the semantic labels and section each check belongs
 * to, because the registry keys documents by form field rather than by
 * regulator.
 */

export const reviewVerificationStatuses = [
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'NOT_APPLICABLE',
] as const;
export type ReviewVerificationStatus = (typeof reviewVerificationStatuses)[number];

export const reviewVerificationStatusLabels: Record<ReviewVerificationStatus, string> = {
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  NOT_APPLICABLE: 'Not applicable',
};

export const suspensionScopes = ['WHOLE_PROFILE', 'LOCATION', 'SERVICE_CATEGORY'] as const;
export type SuspensionScope = (typeof suspensionScopes)[number];

export const suspensionScopeLabels: Record<SuspensionScope, string> = {
  WHOLE_PROFILE: 'Whole profile',
  LOCATION: 'One location',
  SERVICE_CATEGORY: 'One service category',
};

export interface VerificationItemDefinition {
  /** Stable code stored in `verification_records.item`. */
  code: string;
  label: string;
  sectionKey: string;
  providerTypes: readonly ProviderType[];
  /** Registry document key per provider type, used to derive required/optional. */
  documentKeys?: Partial<Record<ProviderType, string>>;
  /** Used when no registry document key applies. */
  required?: boolean;
}

const allTypes = providerTypes;

export const verificationItemCatalogue: readonly VerificationItemDefinition[] = [
  {
    code: 'registration',
    label: 'Registration',
    sectionKey: 'legal_entity',
    providerTypes: allTypes,
    required: true,
  },
  {
    code: 'qualification',
    label: 'Qualification',
    sectionKey: 'doctor_qualifications',
    providerTypes: ['doctor'],
    required: true,
  },
  {
    code: 'address',
    label: 'Address / premises',
    sectionKey: 'registered_office',
    providerTypes: allTypes,
    required: true,
  },
  {
    code: 'signatory_authority',
    label: 'Signatory authority',
    sectionKey: 'signatory',
    providerTypes: allTypes,
    documentKeys: {
      doctor: 'sig_authority_doc',
      clinic: 'sig_authority_doc',
      pharmacy: 'sig_authority_doc',
      diagnostic_centre: 'sig_authority_doc',
      care_provider: 'sig_authority_doc',
    },
  },
  {
    code: 'insurance',
    label: 'Insurance',
    sectionKey: 'insurance',
    providerTypes: allTypes,
    documentKeys: {
      doctor: 'ins_doc',
      clinic: 'ins_doc',
      pharmacy: 'ins_doc',
      diagnostic_centre: 'ins_doc',
      care_provider: 'ins_doc',
    },
  },
  {
    code: 'consent',
    label: 'Consent / declarations',
    sectionKey: 'declarations',
    providerTypes: allTypes,
    required: true,
  },
  {
    code: 'drug_licence',
    label: 'Drug licence',
    sectionKey: 'pharmacy_premises',
    providerTypes: ['pharmacy'],
    documentKeys: { pharmacy: 'ph_licences.document' },
  },
  {
    code: 'pharmacist_registration',
    label: 'Pharmacist registration',
    sectionKey: 'pharmacy_pharmacists',
    providerTypes: ['pharmacy'],
    required: true,
  },
  {
    code: 'establishment_licence',
    label: 'Establishment licence',
    sectionKey: 'clinic_establishment',
    providerTypes: ['clinic', 'diagnostic_centre'],
    documentKeys: { clinic: 'clinic_ce_doc', diagnostic_centre: 'dc_establishment.document' },
  },
  {
    code: 'nabl',
    label: 'NABL accreditation',
    sectionKey: 'diagnostic_licences',
    providerTypes: ['diagnostic_centre'],
    documentKeys: { diagnostic_centre: 'dc_nabl_details.document' },
  },
  {
    code: 'pcpndt',
    label: 'PC-PNDT registration',
    sectionKey: 'diagnostic_licences',
    providerTypes: ['diagnostic_centre'],
    documentKeys: { diagnostic_centre: 'dc_pcpndt_doc' },
  },
  {
    code: 'aerb',
    label: 'AERB permission',
    sectionKey: 'diagnostic_licences',
    providerTypes: ['clinic', 'diagnostic_centre'],
    documentKeys: { clinic: 'clinic_aerb_doc', diagnostic_centre: 'dc_aerb.document' },
  },
  {
    code: 'bmw',
    label: 'Biomedical waste authorisation',
    sectionKey: 'diagnostic_licences',
    providerTypes: ['clinic', 'diagnostic_centre'],
    documentKeys: { clinic: 'clinic_bmw_doc', diagnostic_centre: 'dc_bmw_doc' },
  },
];

export interface RequiredVerificationItem {
  code: string;
  label: string;
  sectionKey: string;
  required: boolean;
}

/** The checklist created when a provider submits (idempotent). */
export function requiredVerificationItemsFor(
  providerType: ProviderType,
): RequiredVerificationItem[] {
  const documents = new Map(documentRequirementsFor(providerType).map((doc) => [doc.key, doc]));
  return verificationItemCatalogue
    .filter((definition) => definition.providerTypes.includes(providerType))
    .map((definition) => {
      const documentKey = definition.documentKeys?.[providerType];
      const document = documentKey ? documents.get(documentKey) : undefined;
      const required = document
        ? document.requirement === 'required'
        : (definition.required ?? true);
      return {
        code: definition.code,
        label: definition.label,
        // Keep the registry section when the catalogue is generic.
        sectionKey: definition.sectionKey,
        required,
      };
    });
}

/** Doctor profiles linked to a clinic get their own registration/qualification checks. */
export function doctorVerificationItems(): RequiredVerificationItem[] {
  return [
    {
      code: 'registration',
      label: 'Medical registration',
      sectionKey: 'doctor_identity',
      required: true,
    },
    {
      code: 'qualification',
      label: 'Qualification',
      sectionKey: 'doctor_qualifications',
      required: true,
    },
  ];
}

/** Which checks a change resets. Used when staff fix items after a change request. */
export function verificationItemsForSection(sectionKey: string): string[] {
  switch (sectionKey) {
    case 'licences':
    case 'clinic_establishment':
    case 'pharmacy_premises':
    case 'diagnostic_licences':
    case 'care_licences':
      return ['drug_licence', 'establishment_licence', 'nabl', 'pcpndt', 'aerb', 'bmw'];
    case 'insurance':
      return ['insurance'];
    case 'registered_office':
    case 'locations':
      return ['address'];
    case 'legal_entity':
      return ['registration'];
    case 'doctor_identity':
      return ['registration'];
    case 'doctor_qualifications':
      return ['qualification'];
    case 'signatory':
      return ['signatory_authority'];
    default:
      return [];
  }
}

export const reviewVerificationUpdateSchema = z
  .object({
    status: z.enum(reviewVerificationStatuses),
    source: z.string().trim().max(200).optional(),
    evidence_ref: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(1000).optional(),
    next_verification_on: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'REJECTED' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Give a reason when rejecting an item',
      });
    }
  });
export type ReviewVerificationUpdate = z.infer<typeof reviewVerificationUpdateSchema>;

export const reviewCommentSchema = z
  .object({
    section_key: z.string().trim().min(1).max(80),
    body: z.string().trim().min(3).max(2000),
  })
  .strict();
export type ReviewCommentInput = z.infer<typeof reviewCommentSchema>;

export const reviewDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }).strict(),
  z
    .object({
      decision: z.literal('request_changes'),
      comment: z.string().trim().min(5).max(2000),
      sections: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    })
    .strict(),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(5).max(1000) }).strict(),
  z
    .object({
      decision: z.literal('suspend'),
      reason: z.string().trim().min(5).max(1000),
      scope: z.enum(suspensionScopes),
      scope_ref_id: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal('reinstate'),
      reason: z.string().trim().min(5).max(1000),
      scope: z.enum(suspensionScopes).optional(),
      scope_ref_id: z.string().uuid().optional(),
    })
    .strict(),
]);
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const reviewQueueQuerySchema = z
  .object({
    providerType: z.preprocess(
      (value) => {
        if (value === undefined || value === null || value === '') return undefined;
        const entries = Array.isArray(value) ? value : [value];
        return entries
          .flatMap((entry) => String(entry).split(','))
          .map((entry) => entry.trim())
          .filter(Boolean);
      },
      z.array(z.enum(providerTypes)).optional(),
    ),
    pin: z
      .string()
      .trim()
      .regex(/^\d{1,6}$/, 'PIN filters accept 1–6 digits')
      .optional(),
    staff: z.string().uuid().optional(),
    assignedToMe: z.preprocess((value) => {
      if (value === true || value === 'true' || value === '1') return true;
      if (value === false || value === 'false' || value === '0') return false;
      return undefined;
    }, z.boolean().optional()),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const reviewSettingsSchema = z
  .object({
    warn_hours: z.coerce.number().int().min(1).max(720),
    breach_hours: z.coerce.number().int().min(2).max(1440),
  })
  .strict()
  .refine((value) => value.breach_hours > value.warn_hours, {
    path: ['breach_hours'],
    message: 'The breach threshold must be later than the warning threshold',
  });
export type ReviewSettingsInput = z.infer<typeof reviewSettingsSchema>;

export interface ReviewSlaSettings {
  warnHours: number;
  breachHours: number;
}

export const defaultReviewSla: ReviewSlaSettings = { warnHours: 48, breachHours: 72 };

export type ReviewSlaState = 'ok' | 'warning' | 'breached';

export function reviewSlaState(
  submittedAt: Date | null,
  now: Date,
  settings: ReviewSlaSettings,
): ReviewSlaState {
  if (!submittedAt) return 'ok';
  const hours = (now.getTime() - submittedAt.getTime()) / (60 * 60 * 1000);
  if (hours >= settings.breachHours) return 'breached';
  if (hours >= settings.warnHours) return 'warning';
  return 'ok';
}

export interface ReviewChecklistProgress {
  total: number;
  required: number;
  verified: number;
  notApplicable: number;
  pending: number;
  rejected: number;
  expired: number;
  /** Required items not yet VERIFIED or NOT_APPLICABLE. */
  blocking: number;
}

export interface ReviewVerificationDto {
  id: string;
  item: string;
  label: string;
  sectionKey: string | null;
  required: boolean;
  status: ReviewVerificationStatus;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  source: string | null;
  evidenceRef: string | null;
  reason: string | null;
  nextVerificationOn: string | null;
}

export interface ReviewCommentDto {
  id: string;
  sectionKey: string;
  body: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export interface ReviewQueueRow {
  id: string;
  code: string;
  legalName: string | null;
  providerType: ProviderType;
  status: OrganizationStatus;
  pinCode: string | null;
  submittedAt: string | null;
  ageHours: number | null;
  sla: ReviewSlaState;
  staff: { id: string; name: string; email: string } | null;
  assignedTo: { id: string; name: string } | null;
  checklist: ReviewChecklistProgress;
}

export interface ReviewQueueResult {
  rows: ReviewQueueRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  settings: ReviewSlaSettings;
}

export interface ReviewDetail {
  organization: {
    id: string;
    code: string;
    providerType: ProviderType;
    status: OrganizationStatus;
    legalName: string | null;
    tradeName: string | null;
    primaryPinCode: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
    version: number;
    createdByUserId: string;
  };
  staff: { id: string; name: string; email: string } | null;
  assignment: { reviewerUserId: string; reviewerName: string; assignedAt: string } | null;
  verifications: ReviewVerificationDto[];
  comments: ReviewCommentDto[];
  checklist: ReviewChecklistProgress;
  /** False while any required item is still PENDING/REJECTED/EXPIRED. */
  canApprove: boolean;
  documents: Array<{
    id: string;
    fileName: string;
    documentTypeName: string;
    role: string | null;
    status: string;
    url: string;
  }>;
  sections: Array<{
    key: string;
    title: string;
    fields: Array<{ key: string; label: string; value: string }>;
  }>;
  canSuspend: boolean;
  canReinstate: boolean;
  suspension: {
    scope: SuspensionScope | null;
    scopeLabel: string | null;
    reason: string | null;
  } | null;
  /** Choices offered when a suspension is limited to a location or service category. */
  scopeOptions: {
    locations: Array<{ id: string; label: string }>;
    services: Array<{ id: string; label: string }>;
  };
}

export interface ReviewSettingsDto {
  warnHours: number;
  breachHours: number;
  updatedAt: string | null;
}
