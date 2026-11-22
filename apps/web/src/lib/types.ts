import type {
  OrganizationStatus,
  ProviderStatus,
  ProviderType,
  Role,
  VerificationItem,
  VerificationStatus,
} from '@curenear/shared';

/** API responses serialize dates as ISO strings. */

export interface ProviderDto {
  id: string;
  providerType: ProviderType;
  status: ProviderStatus;
  displayName: string | null;
  legalName: string | null;
  data: Record<string, unknown>;
  primaryPinCode: string | null;
  city: string | null;
  version: number;
  createdByUserId: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  decisionReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDto {
  id: string;
  ownerType: 'provider' | 'provider_organization';
  ownerId: string;
  documentTypeId: string;
  documentTypeCode: string;
  documentTypeName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string | null;
  checksumSha256: string | null;
  status: 'PENDING_SCAN' | 'UPLOADED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  expiresOn: string | null;
  uploadedByUserId: string;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationDto {
  id: string;
  providerId: string;
  item: VerificationItem;
  status: VerificationStatus;
  verifiedByUserId: string | null;
  verifiedOn: string | null;
  source: string | null;
  evidenceRef: string | null;
  reason: string | null;
  nextVerificationDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionDto {
  id: string;
  providerId: string;
  version: number;
  status: ProviderStatus;
  changedByUserId: string;
  changedFieldKeys: string[];
  createdAt: string;
}

export interface AuditDto {
  id: string;
  action: string;
  actorUserId: string | null;
  actorRole: Role | null;
  fromStatus: ProviderStatus | null;
  toStatus: ProviderStatus | null;
  reason: string | null;
  changedFieldKeys: string[];
  createdAt: string;
}

export interface ProviderDetailDto {
  provider: ProviderDto;
  verifications: VerificationDto[];
  revisions: RevisionDto[];
  audit: AuditDto[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export interface StateDto {
  id: string;
  code: string;
  name: string;
}

export interface DistrictDto {
  id: string;
  stateId: string;
  name: string;
  stateCode: string;
}

export interface PincodeDto {
  pinCode: string;
  officeName: string;
  districtId: string | null;
  districtName: string | null;
  stateId: string | null;
  stateName: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

export interface PincodeStatsDto {
  totalPins: number;
  totalDistricts: number;
  lastUpdatedAt: string | null;
}

/** What the browser upload reports back, mirroring the CLI's counts. */
export interface PincodeImportSummaryDto {
  fileName: string;
  dryRun: boolean;
  rowsRead: number;
  uniquePins: number;
  added: number;
  updated: number;
  skipped: number;
  unchanged: number;
  districtsCreated: number;
  statesMatched: number;
  unknownStates: string[];
  skippedReasons: Record<string, number>;
  durationMs: number;
  stats: PincodeStatsDto;
}

export interface SpecialtyDto {
  id: string;
  code: string;
  name: string;
  systemOfMedicine: string;
  isActive: boolean;
}

export interface CouncilDto {
  id: string;
  code: string;
  name: string;
  kind: string;
  stateId: string | null;
  stateName: string | null;
  isActive: boolean;
}

export interface ServiceCategoryDto {
  id: string;
  code: string;
  name: string;
  providerType: string;
  isActive: boolean;
}

export interface DocumentTypeDto {
  id: string;
  code: string;
  name: string;
  providerTypes: string[];
  requiresExpiry: boolean;
  expiryReminderDays: number[];
  isActive: boolean;
}

export interface StaffDto {
  id: string;
  email: string;
  name: string;
  mobile: string | null;
  employeeCode: string | null;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  mustChangePassword: boolean;
  pinCodes: string[];
  createdByUserId: string | null;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface StaffDetailDto {
  staff: StaffDto;
  providerCount: number;
  recentAudit: AuditDto[];
}

export interface CreatedStaffDto {
  staff: StaffDto;
}

export interface StaffCredentialsDto {
  staff: StaffDto;
  temporaryPassword: string;
}

export interface OrgLocationDto {
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
  createdAt: string;
  updatedAt: string;
}

export interface OrgContactDto {
  id: string;
  organizationId: string;
  role: string;
  name: string;
  designation: string | null;
  phone: string;
  email: string | null;
  address: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgInsuranceDto {
  id: string;
  organizationId: string;
  type: string;
  insurer: string;
  policyNo: string;
  limitPaise: number | null;
  validFrom: string | null;
  validTo: string | null;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgServicePinDto {
  id: string;
  organizationId: string;
  pinCode: string;
  serviceKind: string;
  createdAt: string;
}

export interface SectionCompletenessDto {
  key: string;
  title: string;
  status: 'empty' | 'in_progress' | 'complete';
  missingFields: string[];
  missingDocuments: string[];
}

export interface CompletenessDto {
  complete: boolean;
  sections: SectionCompletenessDto[];
  missingRequiredFields: string[];
  missingDocuments: string[];
}

export interface OrganizationDto {
  id: string;
  code: string;
  providerType: ProviderType;
  status: OrganizationStatus;
  legalName: string | null;
  tradeName: string | null;
  constitutionType: string | null;
  registrationNumber: string | null;
  establishedOn: string | null;
  website: string | null;
  email: string | null;
  mobile: string | null;
  primaryPinCode: string | null;
  primaryDistrictId: string | null;
  primaryStateId: string | null;
  typeData: Record<string, unknown>;
  profileData: Record<string, unknown>;
  publicationConsents: Record<string, unknown>;
  createdByUserId: string;
  submittedAt: string | null;
  approvedAt: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgDocumentDto {
  id: string;
  organizationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string | null;
  role: string | null;
  uploadedByUserId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface DoctorProfileDto {
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
  status: string;
  createdByOrgId: string | null;
  doctorConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorPracticeDto {
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
  createdAt: string;
  updatedAt: string;
}

export interface ClinicDoctorLinkDto {
  link: DoctorPracticeDto;
  doctor: DoctorProfileDto;
}

export interface OrganizationDetailDto {
  organization: OrganizationDto;
  locations: OrgLocationDto[];
  contacts: OrgContactDto[];
  insurance: OrgInsuranceDto[];
  servicePins: OrgServicePinDto[];
  documents: OrgDocumentDto[];
  licences: unknown[];
  doctorProfile?: DoctorProfileDto | null;
  doctorPractices?: DoctorPracticeDto[];
  clinicDoctors?: ClinicDoctorLinkDto[];
  completeness: CompletenessDto;
  /** Latest reviewer comment when the provider was returned for changes. */
  changeRequest?: { comment: string; at: string } | null;
  /** Per-section reviewer notes shown while changes are requested. */
  reviewComments?: Array<{
    id: string;
    sectionKey: string;
    body: string;
    authorName: string;
    authorRole: string;
    createdAt: string;
  }>;
}

export interface PageMetaDto {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string;
  order: 'asc' | 'desc';
}

/** One row of the admin provider directory. Dates arrive as ISO strings. */
export interface AdminProviderRowDto {
  id: string;
  code: string;
  providerType: ProviderType;
  status: OrganizationStatus;
  legalName: string | null;
  tradeName: string | null;
  mobile: string | null;
  registrationNumber: string | null;
  primaryPinCode: string | null;
  stateName: string | null;
  districtName: string | null;
  createdByUserId: string;
  createdByName: string | null;
  createdByEmail: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  documentCount: number;
  earliestLicenceExpiry: string | null;
}

export interface StaffProviderRowDto extends AdminProviderRowDto {
  changeRequest: { comment: string; at: string } | null;
}

export interface AdminProviderFacetsDto {
  byType: Array<{ providerType: ProviderType; count: number }>;
  byStatus: Array<{ status: OrganizationStatus; count: number }>;
}

export interface AdminProviderMetaDto extends PageMetaDto {
  facets: AdminProviderFacetsDto;
}

export interface ProviderDirectoryViewDto {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProviderDetailDto {
  detail: OrganizationDetailDto;
  statusHistory: Array<{
    id: string;
    fromStatus: OrganizationStatus | null;
    toStatus: OrganizationStatus;
    changedByUserId: string;
    reason: string | null;
    at: string;
  }>;
  audit: AuditDto[];
  staff: StaffDto | null;
}

export type ConsentTypeDto =
  'publication' | 'data_privacy_notice' | 'declarations' | 'doctor_confirmation' | 'agreement';

export type ConsentMethodDto =
  'SIGNED_FORM_UPLOAD' | 'OTP' | 'LINK_CONFIRMATION' | 'IN_PERSON_ATTESTATION';

export interface ConsentRecordDto {
  id: string;
  organizationId: string;
  doctorProfileId: string | null;
  consentType: ConsentTypeDto;
  textVersion: string;
  capturedByUserId: string | null;
  capturedAt: string;
  method: ConsentMethodDto;
  evidenceDocumentId: string | null;
  confirmationMeta: Record<string, unknown>;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AgreementAcceptanceDto {
  id: string;
  templateId: string;
  method: ConsentMethodDto;
  signedOn: string;
  place: string;
  signatoryName: string;
  signatoryDesignation: string;
  signedDocumentId: string | null;
  stampReference: string | null;
  witnesses: Array<Record<string, unknown>>;
  recordedByUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
  templateName: string | null;
  templateVersion: string | null;
}

export interface AgreementTemplateDto {
  id: string;
  providerType: ProviderType;
  name: string;
  version: string;
  effectiveFrom: string;
  bodyHash: string;
  status: 'draft' | 'active' | 'retired';
}

export interface DeclarationDto {
  key: string;
  label: string;
  text: string;
}

export interface ConsentGapDto {
  kind: 'publication' | 'data_privacy_notice' | 'declaration' | 'agreement' | 'doctor_confirmation';
  key: string;
  label: string;
}

export interface ConsentOverviewDto {
  organizationId: string;
  providerType: ProviderType;
  consents: ConsentRecordDto[];
  agreements: AgreementAcceptanceDto[];
  templates: AgreementTemplateDto[];
  activeTemplate: AgreementTemplateDto | null;
  declarations: DeclarationDto[];
  gaps: ConsentGapDto[];
  agreementRequired: boolean;
  agreementDeferredNote: string;
  confirmations: Array<{
    id: string;
    doctorProfileId: string | null;
    expiresAt: string;
    usedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    role: string | null;
    mimeType: string;
    createdAt: string;
  }>;
  clinicDoctors: Array<{ id: string; fullName: string; status: string; confirmed: boolean }>;
  linksEnabled: boolean;
}

export interface FieldIssue {
  path: string;
  message: string;
}
