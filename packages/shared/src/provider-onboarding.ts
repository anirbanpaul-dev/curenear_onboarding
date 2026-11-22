import { z } from 'zod';
import { organizationStatuses, type OrganizationStatus } from './provider-lifecycle';
import { providerTypes, type ProviderType } from './enums';
import { diagnosticHighRiskWorkflows } from './fields/options';
import { mobileSchema, pinCodeSchema } from './utils';

/**
 * Records and inputs for the provider onboarding API (`/api/v1/providers`).
 * Common data lives in relational columns/tables; everything type-specific is
 * `type_data`, validated by the field registry's generated schema.
 */

export interface ProviderOrganizationRecord {
  id: string;
  code: string;
  providerType: ProviderType;
  status: OrganizationStatus;
  legalName: string | null;
  tradeName: string | null;
  constitutionType: string | null;
  registrationNumber: string | null;
  establishedOn: Date | null;
  website: string | null;
  email: string | null;
  mobile: string | null;
  primaryPinCode: string | null;
  primaryDistrictId: string | null;
  primaryStateId: string | null;
  typeData: Record<string, unknown>;
  typeDataSchemaVersion: number;
  profileData: Record<string, unknown>;
  publicationConsents: Record<string, unknown>;
  createdByUserId: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderLocationRecord {
  id: string;
  organizationId: string;
  name: string;
  locationType: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  districtId: string | null;
  stateId: string | null;
  pinCode: string;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  isPublic: boolean;
  operatingHours: Record<string, unknown>;
  bookingPhone: string | null;
  branchRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderContactRecord {
  id: string;
  organizationId: string;
  role: string;
  name: string;
  designation: string | null;
  phone: string;
  email: string | null;
  /** Postal address, used by the legal-notice contact. */
  address: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderLicenceRecord {
  id: string;
  organizationId: string;
  locationId: string | null;
  licenceTypeId: string | null;
  number: string;
  authority: string | null;
  issuedOn: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  status: string;
  documentId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderInsuranceRecord {
  id: string;
  organizationId: string;
  type: string;
  insurer: string;
  policyNo: string;
  limitPaise: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DoctorProfileStatus =
  'invited' | 'doctor_confirmed' | 'under_review' | 'approved' | 'changes_requested' | 'rejected';

export interface DoctorProfileRecord {
  id: string;
  organizationId: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  registrationNo: string;
  councilId: string | null;
  councilName: string | null;
  systemOfMedicine: string;
  specialtyId: string | null;
  specialtyName: string | null;
  qualifications: Array<Record<string, unknown>>;
  photoDocumentId: string | null;
  status: DoctorProfileStatus;
  createdByOrgId: string | null;
  doctorConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A doctor's practice link: either a standalone practice or a clinic link. */
export interface DoctorLocationRecord {
  id: string;
  doctorProfileId: string;
  locationId: string | null;
  clinicOrganizationId: string | null;
  roleAtClinic: string | null;
  practiceType: string | null;
  address: Record<string, unknown> | null;
  publicContact: string | null;
  timings: Array<Record<string, unknown>>;
  feePaise: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicDoctorLinkRecord {
  link: DoctorLocationRecord;
  doctor: DoctorProfileRecord;
}

export interface ProviderServicePinRecord {
  id: string;
  organizationId: string;
  pinCode: string;
  serviceKind: string;
  createdAt: Date;
}

export interface ProviderDocumentRecord {
  id: string;
  organizationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string | null;
  role: string | null;
  uploadedByUserId: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ProviderStatusHistoryRecord {
  id: string;
  organizationId: string;
  fromStatus: OrganizationStatus | null;
  toStatus: OrganizationStatus;
  changedByUserId: string;
  reason: string | null;
  scope: string | null;
  scopeRefId: string | null;
  scopeLabel: string | null;
  flaggedSections: string[];
  at: Date;
}

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form');

export const createOrganizationSchema = z
  .object({
    provider_type: z.enum(providerTypes),
    legal_name: trimmed(200),
    trade_name: optionalTrimmed(200),
    registration_number: optionalTrimmed(80),
    email: z.string().trim().email('Enter a valid email address').max(200).optional(),
    mobile: mobileSchema.optional(),
    website: z.string().trim().url('Enter a valid website address').max(300).optional(),
    /** The registered-office PIN captured on the start page, before the address. */
    primary_pin_code: pinCodeSchema.optional(),
  })
  .strict();
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Used by the start page to show duplicate warnings before a draft exists. */
export const duplicatePreviewSchema = z
  .object({
    legal_name: trimmed(200),
    mobile: mobileSchema.optional(),
    pin_code: pinCodeSchema.optional(),
  })
  .strict();
export type DuplicatePreviewInput = z.infer<typeof duplicatePreviewSchema>;

export const sectionSaveSchema = z
  .object({
    version: z.number().int().positive(),
    data: z.record(z.unknown()),
  })
  .strict();
export type SectionSaveInput = z.infer<typeof sectionSaveSchema>;

/** Sub-resource inputs use the snake_case field names the registry uses. */
export const locationInputSchema = z
  .object({
    name: trimmed(200),
    location_type: trimmed(60),
    address_line1: trimmed(200),
    address_line2: optionalTrimmed(200),
    landmark: optionalTrimmed(120),
    city: trimmed(120),
    district_id: z.string().uuid().optional(),
    state_id: z.string().uuid().optional(),
    pin_code: pinCodeSchema,
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    is_primary: z.boolean().optional(),
    is_public: z.boolean().optional(),
    operating_hours: z.record(z.unknown()).optional(),
    booking_phone: mobileSchema.optional(),
    branch_ref: optionalTrimmed(80),
  })
  .strict();
export type LocationInput = z.infer<typeof locationInputSchema>;
export const locationUpdateSchema = locationInputSchema.partial();
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

export const contactAddressSchema = z
  .object({
    line1: trimmed(200),
    line2: optionalTrimmed(200),
    landmark: optionalTrimmed(120),
    city: trimmed(120),
    district: optionalTrimmed(120),
    state: trimmed(120),
    pin: pinCodeSchema,
  })
  .strict();

export const contactInputSchema = z
  .object({
    role: trimmed(40),
    name: trimmed(120),
    designation: optionalTrimmed(120),
    phone: mobileSchema,
    email: z.string().trim().email('Enter a valid email address').max(200).optional(),
    address: contactAddressSchema.optional(),
  })
  .strict();
export type ContactInput = z.infer<typeof contactInputSchema>;

export const licenceInputSchema = z
  .object({
    role: trimmed(60).optional(),
    licence_type_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    number: trimmed(120),
    authority: optionalTrimmed(200),
    issued_on: isoDate.optional(),
    valid_from: isoDate.optional(),
    valid_to: isoDate.optional(),
    status: z.enum(['active', 'expired', 'suspended', 'pending']).optional(),
    document_id: z.string().uuid().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();
export type LicenceInput = z.infer<typeof licenceInputSchema>;
export const licenceUpdateSchema = licenceInputSchema.partial();
export type LicenceUpdateInput = z.infer<typeof licenceUpdateSchema>;

export const insuranceInputSchema = z
  .object({
    type: trimmed(60),
    insurer: trimmed(200),
    policy_no: trimmed(120),
    limit_paise: z.number().int().min(0).optional(),
    valid_from: isoDate.optional(),
    valid_to: isoDate.optional(),
    document_id: z.string().uuid().optional(),
  })
  .strict();
export type InsuranceInput = z.infer<typeof insuranceInputSchema>;
export const insuranceUpdateSchema = insuranceInputSchema.partial();
export type InsuranceUpdateInput = z.infer<typeof insuranceUpdateSchema>;

export const servicePinInputSchema = z
  .object({
    pin_code: pinCodeSchema,
    service_kind: trimmed(60).default('service'),
  })
  .strict();
export type ServicePinInput = z.infer<typeof servicePinInputSchema>;

export const documentInputSchema = z
  .object({
    file_name: trimmed(200),
    mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    storage_key: optionalTrimmed(300),
    role: trimmed(60),
  })
  .strict();
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const doctorProfileSaveSchema = z
  .object({
    version: z.number().int().positive(),
    section: z.enum(['doctor_identity', 'doctor_qualifications']),
    data: z.record(z.unknown()),
  })
  .strict();
export type DoctorProfileSaveInput = z.infer<typeof doctorProfileSaveSchema>;

export const doctorPracticeAddressSchema = z
  .object({
    line1: trimmed(200),
    line2: optionalTrimmed(200),
    landmark: optionalTrimmed(120),
    city: trimmed(120),
    district: optionalTrimmed(120),
    state: trimmed(120),
    pin: pinCodeSchema,
  })
  .strict();

const timingSchema = z
  .object({
    day: trimmed(20),
    start: optionalTrimmed(5),
    end: optionalTrimmed(5),
    slot_minutes: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const doctorPracticeInputSchema = z
  .object({
    version: z.number().int().positive().optional(),
    practice_type: trimmed(60),
    clinic_organization_id: z.string().uuid().optional(),
    address: doctorPracticeAddressSchema,
    timings: z.array(timingSchema).min(1),
    fee_paise: z.number().int().min(0),
    public_contact: trimmed(160),
  })
  .strict();
export type DoctorPracticeInput = z.infer<typeof doctorPracticeInputSchema>;
export const doctorPracticeUpdateSchema = doctorPracticeInputSchema.partial();
export type DoctorPracticeUpdateInput = z.infer<typeof doctorPracticeUpdateSchema>;

export const clinicDoctorSearchSchema = z
  .object({
    registration_no: trimmed(60),
    council: optionalTrimmed(120),
  })
  .strict();
export type ClinicDoctorSearchInput = z.infer<typeof clinicDoctorSearchSchema>;

export const clinicDoctorCreateSchema = z
  .object({
    doctor_profile_id: z.string().uuid().optional(),
    full_name: optionalTrimmed(160),
    mobile: mobileSchema.optional(),
    email: z.string().trim().email('Enter a valid email address').max(200).optional(),
    registration_no: optionalTrimmed(60),
    council: optionalTrimmed(120),
    system_of_medicine: optionalTrimmed(60),
    specialty: optionalTrimmed(120),
    qualifications: z.array(z.record(z.unknown())).optional(),
    role_at_clinic: trimmed(60),
    timings: z.array(timingSchema).min(1),
    fee_paise: z.number().int().min(0),
    clinic_attestation: z.literal(true),
  })
  .strict();
export type ClinicDoctorCreateInput = z.infer<typeof clinicDoctorCreateSchema>;

export const clinicDoctorUpdateSchema = z
  .object({
    role_at_clinic: trimmed(60).optional(),
    timings: z.array(timingSchema).min(1).optional(),
    fee_paise: z.number().int().min(0).optional(),
  })
  .strict();
export type ClinicDoctorUpdateInput = z.infer<typeof clinicDoctorUpdateSchema>;

export const submitOrganizationSchema = z
  .object({
    version: z.number().int().positive().optional(),
    note: optionalTrimmed(1000),
  })
  .strict();
export type SubmitOrganizationInput = z.infer<typeof submitOrganizationSchema>;

export const transitionOrganizationSchema = z
  .object({
    to: z.enum(organizationStatuses),
    version: z.number().int().positive().optional(),
    reason: optionalTrimmed(1000),
  })
  .strict();
export type TransitionOrganizationInput = z.infer<typeof transitionOrganizationSchema>;

export const dismissDuplicateSchema = z
  .object({
    duplicate_provider_id: z.string().uuid(),
    reason: optionalTrimmed(500),
  })
  .strict();
export type DismissDuplicateInput = z.infer<typeof dismissDuplicateSchema>;

/* --- Diagnostic test catalogue import (field-spec 8.3) ------------------- */

export const testCatalogueImportSchema = z
  .object({
    version: z.number().int().positive().optional(),
    csv: z.string().trim().min(1, 'Upload a CSV file').max(2_000_000),
  })
  .strict();
export type TestCatalogueImportPayload = z.infer<typeof testCatalogueImportSchema>;

/* --- Admin-only switches and workflow decisions (7.5, 8.2) --------------- */

export const adminSwitchesSchema = z
  .object({
    version: z.number().int().positive().optional(),
    data: z.record(z.unknown()),
  })
  .strict();
export type AdminSwitchesInput = z.infer<typeof adminSwitchesSchema>;

export const highRiskStatusValues = ['requested', 'approved', 'not approved'] as const;
export type HighRiskStatus = (typeof highRiskStatusValues)[number];

export const highRiskStatusSchema = z
  .object({
    version: z.number().int().positive().optional(),
    statuses: z
      .array(
        z
          .object({
            workflow: z.enum(diagnosticHighRiskWorkflows),
            status: z.enum(highRiskStatusValues),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type HighRiskStatusInput = z.infer<typeof highRiskStatusSchema>;

/* --- Duplicate detection -------------------------------------------------- */

export type DuplicateMatchKind =
  | 'registration_number'
  | 'licence_number'
  | 'mobile_pin'
  | 'legal_name_similar'
  | 'doctor_registration';

export interface DuplicateMatch {
  kind: DuplicateMatchKind;
  providerId: string;
  providerCode: string;
  providerName: string | null;
  status: OrganizationStatus;
  /** Exact licence numbers and exact doctor registrations block the write. */
  hardBlock: boolean;
  similarity?: number;
  message: string;
  /** Portal link an operator can follow to compare the two records. */
  link: string;
}

export interface DuplicateCheck {
  warnings: DuplicateMatch[];
  blocked: DuplicateMatch[];
}

/* --- Completeness --------------------------------------------------------- */

export type SectionProgress = 'empty' | 'in_progress' | 'complete';

export interface SectionCompleteness {
  key: string;
  title: string;
  status: SectionProgress;
  missingFields: string[];
  missingDocuments: string[];
}

export interface CompletenessReport {
  complete: boolean;
  sections: SectionCompleteness[];
  missingRequiredFields: string[];
  missingDocuments: string[];
}
