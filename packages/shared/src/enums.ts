import type { OrganizationStatus } from './provider-lifecycle';

/** Canonical domain enumerations. Values are the public API contract (lowercase). */

export const roleValues = ['ADMIN', 'STAFF'] as const;
export type Role = (typeof roleValues)[number];

/** Staff account states shown in the admin staff directory. */
export const staffStatuses = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;
export type StaffStatus = (typeof staffStatuses)[number];

export const staffStatusLabels: Record<StaffStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Deactivated',
  LOCKED: 'Locked',
};

export const providerTypes = [
  'doctor',
  'clinic',
  'pharmacy',
  'diagnostic_centre',
  'care_provider',
] as const;
export type ProviderType = (typeof providerTypes)[number];

/** Order mirrors the onboarding workflow in docs/field-spec.md section 2. */
export const providerStatuses = [
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved_not_live',
  'live',
  'suspended',
  'rejected',
  'terminated',
] as const;
export type ProviderStatus = (typeof providerStatuses)[number];

/** Statuses a STAFF user may read and edit (rule 3). */
export const staffEditableStatuses = ['draft', 'changes_requested'] as const;
export type StaffEditableStatus = (typeof staffEditableStatuses)[number];

export function isStaffEditableStatus(status: ProviderStatus): boolean {
  return (staffEditableStatuses as readonly ProviderStatus[]).includes(status);
}

/**
 * Allowed status transitions. Services must reject anything not listed here so
 * client apps cannot drive a provider into an impossible state.
 */
export const statusTransitions: Record<ProviderStatus, readonly ProviderStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'changes_requested', 'rejected', 'approved_not_live'],
  under_review: ['changes_requested', 'rejected', 'approved_not_live'],
  changes_requested: ['submitted'],
  approved_not_live: ['live', 'suspended', 'terminated'],
  live: ['suspended', 'terminated'],
  suspended: ['live', 'approved_not_live', 'terminated'],
  rejected: ['submitted'],
  terminated: [],
};

export function canTransition(from: ProviderStatus, to: ProviderStatus): boolean {
  return statusTransitions[from].includes(to);
}

export const verificationStatuses = [
  'pending',
  'verified',
  'rejected',
  'expired',
  'not_applicable',
] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

/**
 * Admin verification checklist items (docs/field-spec.md section 10).
 * `vr_item` values, kept as a closed list so the checkbox set stays reviewable.
 */
export const verificationItems = [
  'medical_registration',
  'qualification',
  'practice_location',
  'establishment_compliance',
  'drug_licence',
  'pharmacist_registration',
  'nabl_accreditation',
  'pc_pndt',
  'aerb_permission',
  'establishment_licence',
  'biomedical_waste',
  'insurance',
  'address',
  'signatory_authority',
  'privacy_notice',
] as const;
export type VerificationItem = (typeof verificationItems)[number];

export const verificationItemLabels: Record<VerificationItem, string> = {
  medical_registration: 'Medical registration',
  qualification: 'Qualification',
  practice_location: 'Practice location',
  establishment_compliance: 'Establishment compliance',
  drug_licence: 'Drug licence',
  pharmacist_registration: 'Pharmacist registration',
  nabl_accreditation: 'NABL accreditation',
  pc_pndt: 'PC-PNDT registration',
  aerb_permission: 'AERB permission',
  establishment_licence: 'Establishment licence',
  biomedical_waste: 'Biomedical waste authorisation',
  insurance: 'Insurance',
  address: 'Address',
  signatory_authority: 'Signatory authority',
  privacy_notice: 'Privacy notice acknowledged',
};

export const providerTypeLabels: Record<ProviderType, string> = {
  doctor: 'Doctor',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  diagnostic_centre: 'Diagnostic centre',
  care_provider: 'Care provider',
};

export const organizationStatusLabels: Record<OrganizationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
  TERMINATED: 'Terminated',
};

export const providerStatusLabels: Record<ProviderStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  changes_requested: 'Changes requested',
  approved_not_live: 'Approved (not live)',
  live: 'Live',
  suspended: 'Suspended',
  rejected: 'Rejected',
  terminated: 'Terminated',
};

export const providerReviewDecisions = ['approve', 'request_changes', 'reject'] as const;
export type ProviderReviewDecision = (typeof providerReviewDecisions)[number];

/** Indian states and union territories (registered-office / notice address select). */
export const indianStates = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

export const defaultState = 'West Bengal';

/**
 * Systems of medicine a practitioner or clinic can be registered under
 * (docs/CureNear_Provider_Onboarding_Field_Spec.md 4.1, 6.1). `field-registry`
 * keeps the doctor-form subset; the master list also allows physiotherapy.
 */
export const systemsOfMedicineCodes = [
  'allopathy',
  'dental',
  'ayurveda',
  'homeopathy',
  'unani',
  'siddha',
  'physiotherapy',
  'other',
] as const;
export type SystemOfMedicineCode = (typeof systemsOfMedicineCodes)[number];

export const systemOfMedicineLabels: Record<SystemOfMedicineCode, string> = {
  allopathy: 'Allopathy',
  dental: 'Dental',
  ayurveda: 'Ayurveda',
  homeopathy: 'Homeopathy',
  unani: 'Unani',
  siddha: 'Siddha',
  physiotherapy: 'Physiotherapy',
  other: 'Other',
};

/** Regulator type for a council row; the councils themselves are data. */
export const councilKinds = ['medical', 'pharmacy', 'nursing', 'other'] as const;
export type CouncilKind = (typeof councilKinds)[number];

export const councilKindLabels: Record<CouncilKind, string> = {
  medical: 'Medical',
  pharmacy: 'Pharmacy',
  nursing: 'Nursing',
  other: 'Other',
};
