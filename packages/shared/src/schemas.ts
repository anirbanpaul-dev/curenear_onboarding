import { z } from 'zod';
import {
  councilKinds,
  providerReviewDecisions,
  providerStatuses,
  providerTypes,
  roleValues,
  systemsOfMedicineCodes,
  verificationItems,
  verificationStatuses,
} from './enums';
import { isoDateSchema, mobileSchema, pinCodeSchema } from './utils';
import { consentMethods } from './consents';

/** API-layer schemas. Services still validate provider form data against the registry. */

const multi = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) {
      const values = value.filter((entry): entry is string => typeof entry === 'string');
      return values.length > 0 ? values : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const parts = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }, z.array(item).optional());

export const providerSortFields = [
  'createdAt',
  'updatedAt',
  'displayName',
  'status',
  'providerType',
] as const;

export const listProvidersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(providerSortFields).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().max(120).optional(),
  providerType: multi(z.enum(providerTypes)),
  status: multi(z.enum(providerStatuses)),
  pin: pinCodeSchema.optional(),
  city: z.string().trim().max(120).optional(),
  createdByUserId: z.string().uuid().optional(),
  createdFrom: isoDateSchema.optional(),
  createdTo: isoDateSchema.optional(),
});

export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;

export const providerIdParamsSchema = z.object({ id: z.string().uuid() });

export const createProviderSchema = z
  .object({
    providerType: z.enum(providerTypes),
    /** Optional partial data so a draft can carry the name the operator already knows. */
    data: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z
  .object({
    version: z.number().int().positive(),
    data: z.record(z.unknown()),
  })
  .strict();

export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const reviewProviderSchema = z
  .object({
    decision: z.enum(providerReviewDecisions),
    reason: z.string().trim().min(5).max(1000).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision !== 'approve' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Give the provider a reason for this decision',
      });
    }
  });

export type ReviewProviderInput = z.infer<typeof reviewProviderSchema>;

export const submitProviderSchema = z
  .object({
    declarationsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Confirm the declarations before submitting' }),
    }),
  })
  .strict();

export const softDeleteProviderSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(5, 'Give a reason for deleting this draft').max(500),
  })
  .strict();

export type SoftDeleteProviderInput = z.infer<typeof softDeleteProviderSchema>;

export const verificationUpdateSchema = z
  .object({
    item: z.enum(verificationItems),
    status: z.enum(verificationStatuses),
    source: z.string().trim().max(200).optional(),
    evidenceRef: z.string().trim().max(300).optional(),
    reason: z.string().trim().max(1000).optional(),
    nextVerificationDate: isoDateSchema.optional(),
  })
  .strict();

export type VerificationUpdateInput = z.infer<typeof verificationUpdateSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: z.string().min(1, 'Enter your password').max(200),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: z.string().min(1, 'Enter a new password').max(200),
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, 'This reset link is invalid').max(200),
    password: z.string().min(1, 'Choose a new password').max(200),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the staff member name').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    role: z.enum(roleValues),
    temporaryPassword: z
      .string()
      .min(12, 'Use a temporary password of at least 12 characters')
      .max(200),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const deactivateUserSchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

// --- Staff management (admin only) -----------------------------------------

/** Internal hire reference; unique across staff accounts. */
export const employeeCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/, 'Use 3-20 letters, digits, hyphens or underscores');

export const staffTerritoryPinSchema = z.array(pinCodeSchema).max(50).optional();

export const createStaffSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the staff member name').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid work email'),
    mobile: mobileSchema,
    employeeCode: employeeCodeSchema,
    pinCodes: staffTerritoryPinSchema,
  })
  .strict();

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    mobile: mobileSchema.optional(),
    employeeCode: employeeCodeSchema.optional(),
    pinCodes: staffTerritoryPinSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const staffStatusFilterValues = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;

export const listStaffQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['name', 'createdAt', 'status', 'employeeCode']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().trim().max(120).optional(),
  status: z.enum(staffStatusFilterValues).optional(),
});

export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

export const staffIdParamsSchema = z.object({ id: z.string().uuid() });

export const deactivateStaffSchema = z
  .object({
    reason: z.string().trim().min(5, 'Give a reason for deactivating this account').max(500),
  })
  .strict();

export type DeactivateStaffInput = z.infer<typeof deactivateStaffSchema>;

// --- Master data -----------------------------------------------------------

/** Stable machine key shown in exports; lowercase so lookups are unambiguous. */
export const masterCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9_-]{1,49}$/,
    'Use 2-50 lowercase letters, digits, hyphens or underscores',
  );

const masterNameSchema = z.string().trim().min(2, 'Enter a name').max(160);

export const pincodeSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters').max(60),
});

export const pincodeParamSchema = z.object({ pin: pinCodeSchema });

export const masterListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  providerType: z.enum(providerTypes).optional(),
  stateId: z.string().uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export type MasterListQuery = z.infer<typeof masterListQuerySchema>;

export const masterIdParamsSchema = z.object({ id: z.string().uuid() });

export const createSpecialtySchema = z
  .object({
    code: masterCodeSchema,
    name: masterNameSchema,
    systemOfMedicine: z.enum(systemsOfMedicineCodes),
  })
  .strict();

export const updateSpecialtySchema = z
  .object({
    code: masterCodeSchema.optional(),
    name: masterNameSchema.optional(),
    systemOfMedicine: z.enum(systemsOfMedicineCodes).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export const createCouncilSchema = z
  .object({
    code: masterCodeSchema,
    name: masterNameSchema,
    kind: z.enum(councilKinds),
    stateId: z.string().uuid().nullish(),
  })
  .strict();

export const updateCouncilSchema = z
  .object({
    code: masterCodeSchema.optional(),
    name: masterNameSchema.optional(),
    kind: z.enum(councilKinds).optional(),
    stateId: z.string().uuid().nullish(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export const createServiceCategorySchema = z
  .object({
    code: masterCodeSchema,
    name: masterNameSchema,
    providerType: z.enum(providerTypes),
  })
  .strict();

export const updateServiceCategorySchema = z
  .object({
    code: masterCodeSchema.optional(),
    name: masterNameSchema.optional(),
    providerType: z.enum(providerTypes).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export const createDocumentTypeSchema = z
  .object({
    code: masterCodeSchema,
    name: masterNameSchema,
    providerTypes: z.array(z.enum(providerTypes)).min(1, 'Pick at least one provider type'),
    requiresExpiry: z.boolean().default(false),
    expiryReminderDays: z.array(z.number().int().min(0).max(365)).max(10).default([]),
  })
  .strict()
  .refine(
    (value) => value.requiresExpiry || value.expiryReminderDays.length === 0,
    'Reminder days only apply when the document has an expiry date',
  );

export const updateDocumentTypeSchema = z
  .object({
    code: masterCodeSchema.optional(),
    name: masterNameSchema.optional(),
    providerTypes: z
      .array(z.enum(providerTypes))
      .min(1, 'Pick at least one provider type')
      .optional(),
    requiresExpiry: z.boolean().optional(),
    expiryReminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

export type CreateSpecialtyInput = z.infer<typeof createSpecialtySchema>;
export type UpdateSpecialtyInput = z.infer<typeof updateSpecialtySchema>;
export type CreateCouncilInput = z.infer<typeof createCouncilSchema>;
export type UpdateCouncilInput = z.infer<typeof updateCouncilSchema>;
export type CreateServiceCategoryInput = z.infer<typeof createServiceCategorySchema>;
export type UpdateServiceCategoryInput = z.infer<typeof updateServiceCategorySchema>;
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeSchema>;
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeSchema>;

// --- Consents, agreements and confirmation links ---------------------------

const consentItemSchema = z
  .object({
    consent_type: z.enum([
      'publication',
      'data_privacy_notice',
      'declarations',
      'doctor_confirmation',
    ]),
    declaration_key: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const consentCaptureSchema = z
  .object({
    version: z.number().int().positive().optional(),
    method: z.enum(consentMethods),
    evidence_document_id: z.string().uuid().optional(),
    doctor_profile_id: z.string().uuid().optional(),
    attestation_name: z.string().trim().min(2).max(160).optional(),
    note: z.string().trim().max(500).optional(),
    items: z.array(consentItemSchema).min(1).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'SIGNED_FORM_UPLOAD' && !value.evidence_document_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence_document_id'],
        message: 'Upload the signed form as evidence',
      });
    }
    if (value.method === 'IN_PERSON_ATTESTATION' && !value.attestation_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attestation_name'],
        message: 'Name the person who attested in person',
      });
    }
    value.items.forEach((item, index) => {
      if (item.consent_type === 'declarations' && !item.declaration_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'declaration_key'],
          message: 'Each declaration needs its registry key',
        });
      }
      if (item.consent_type !== 'declarations' && item.declaration_key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'declaration_key'],
          message: 'Only declarations carry a declaration key',
        });
      }
      if (item.consent_type === 'doctor_confirmation' && !value.doctor_profile_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['doctor_profile_id'],
          message: 'Choose the doctor being confirmed',
        });
      }
    });
  });

export type ConsentCaptureInput = z.infer<typeof consentCaptureSchema>;

export const witnessSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().max(300).optional(),
    signature_ref: z.string().trim().max(160).optional(),
  })
  .strict();

export const agreementAcceptanceSchema = z
  .object({
    version: z.number().int().positive().optional(),
    template_id: z.string().uuid(),
    method: z.enum(consentMethods),
    signed_on: isoDateSchema,
    place: z.string().trim().min(2).max(160),
    signatory_name: z.string().trim().min(2).max(160),
    signatory_designation: z.string().trim().min(2).max(120),
    signed_document_id: z.string().uuid().optional(),
    stamp_reference: z.string().trim().max(120).optional(),
    witnesses: z.array(witnessSchema).max(2).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'SIGNED_FORM_UPLOAD' && !value.signed_document_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signed_document_id'],
        message: 'Upload the signed agreement copy',
      });
    }
  });

export type AgreementAcceptanceInput = z.infer<typeof agreementAcceptanceSchema>;

export const consentRevokeSchema = z
  .object({
    reason: z.string().trim().min(5, 'Give a reason for revoking this consent').max(500),
  })
  .strict();

export type ConsentRevokeInput = z.infer<typeof consentRevokeSchema>;

export const confirmationRequestSchema = z
  .object({
    doctor_profile_id: z.string().uuid().optional(),
    expires_in_hours: z.number().int().min(1).max(48).optional(),
  })
  .strict();

export type ConfirmationRequestInput = z.infer<typeof confirmationRequestSchema>;

export const publicConfirmationSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name').max(160),
    designation: z.string().trim().max(120).optional(),
    method: z.enum(['LINK_CONFIRMATION', 'OTP']),
    otp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the six-digit code')
      .optional(),
    declaration_keys: z.array(z.string().trim().min(1).max(80)).max(40),
  })
  .strict();

export type PublicConfirmationInput = z.infer<typeof publicConfirmationSchema>;

export const confirmationOtpRequestSchema = z.object({ mobile: mobileSchema.optional() }).strict();

export const confirmationTokenParamsSchema = z.object({ token: z.string().min(20).max(200) });
