import type { ExportStatus, ExportType } from './exports';
import type {
  AnalyticsFilters,
  AnalyticsGroupBy,
  AnalyticsOverview,
  AnalyticsPinSummary,
  PinStatMeasure,
  StaffPerformanceResult,
} from './analytics';
import type {
  ReviewChecklistProgress,
  ReviewCommentDto,
  ReviewVerificationDto,
  ReviewVerificationUpdate,
  SuspensionScope,
} from './review';
import type { ConsentMethod, ConsentType } from './consents';
import type { ProviderType, ProviderStatus, Role } from './enums';
import type { OrganizationStatus } from './provider-lifecycle';
import type {
  ClinicDoctorLinkRecord,
  DoctorLocationRecord,
  DoctorProfileRecord,
  ProviderContactRecord,
  ProviderDocumentRecord,
  ProviderInsuranceRecord,
  ProviderLicenceRecord,
  ProviderLocationRecord,
  ProviderOrganizationRecord,
  ProviderServicePinRecord,
  ProviderStatusHistoryRecord,
} from './provider-onboarding';
import type {
  DocumentCreateInput,
  DocumentOwnerType,
  DocumentRecord,
  DocumentUpdatePatch,
} from './documents';
import type {
  AdminProviderDirectoryRow,
  AdminProviderFacets,
  AdminProviderFilters,
  AdminProviderSortField,
  ProviderDirectoryViewRecord,
} from './admin-directory';
import type {
  StaffActivityRecord,
  StaffChangeRequestRecord,
  StaffExpiryRecord,
} from './staff-area';
import type {
  AuditEntry,
  CouncilRecord,
  DistrictRecord,
  DocumentTypeRecord,
  FacilityTypeRecord,
  LicenceTypeRecord,
  OutboxEventRecord,
  PincodeImportStats,
  PincodeRecord,
  ServiceCategoryRecord,
  SpecialtyRecord,
  StaffMemberRecord,
  StateRecord,
  ProviderPin,
  ProviderRecord,
  ProviderRevisionRecord,
  ProviderSort,
  SessionRecord,
  UserRecord,
  VerificationRecord,
} from './domain';

export interface ProviderListFilters {
  search?: string;
  providerTypes?: ProviderType[];
  statuses?: ProviderStatus[];
  pin?: string;
  city?: string;
  createdByUserId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface ProviderCreateInput {
  providerType: ProviderType;
  /** Null until the provider supplies its own public display name. */
  displayName: string | null;
  legalName: string | null;
  data: Record<string, unknown>;
  primaryPinCode: string | null;
  city: string | null;
  createdByUserId: string;
  version: number;
  pins: ProviderPin[];
}

export interface ProviderUpdateInput {
  id: string;
  expectedVersion: number;
  patch: {
    data: Record<string, unknown>;
    displayName: string | null;
    legalName: string | null;
    primaryPinCode: string | null;
    city: string | null;
    pins: ProviderPin[];
  };
}

export interface ProviderStatusChangeInput {
  id: string;
  expectedVersion: number;
  fromStatus: ProviderStatus;
  toStatus: ProviderStatus;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
  submittedAt?: Date | null;
}

export interface ProviderRepository {
  findById(id: string, options?: { includeDeleted?: boolean }): Promise<ProviderRecord | null>;
  list(
    filters: ProviderListFilters,
    page: { skip: number; take: number },
    sort: ProviderSort,
  ): Promise<{ rows: ProviderRecord[]; total: number }>;
  create(input: ProviderCreateInput): Promise<ProviderRecord>;
  /** Returns null when the stored version no longer matches (optimistic lock). */
  updateOptimistic(input: ProviderUpdateInput): Promise<ProviderRecord | null>;
  changeStatus(input: ProviderStatusChangeInput): Promise<ProviderRecord | null>;
  softDelete(input: {
    id: string;
    expectedVersion: number;
    deletedAt: Date;
    reason: string;
  }): Promise<ProviderRecord | null>;
  replacePins(providerId: string, pins: ProviderPin[]): Promise<void>;
  createRevision(input: {
    id: string;
    providerId: string;
    version: number;
    status: ProviderStatus;
    changedByUserId: string;
    changedFieldKeys: string[];
    snapshot: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void>;
  listRevisions(providerId: string, limit: number): Promise<ProviderRevisionRecord[]>;
  countByStatus(): Promise<Array<{ status: ProviderStatus; count: number }>>;
  countByType(): Promise<Array<{ providerType: ProviderType; count: number }>>;
  topPins(limit: number): Promise<Array<{ pinCode: string; count: number }>>;
  listDataForExpiryScan(
    limit: number,
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
}

export interface VerificationRepository {
  listByProvider(providerId: string): Promise<VerificationRecord[]>;
  upsert(input: {
    id: string;
    providerId: string;
    item: VerificationRecord['item'];
    status: VerificationRecord['status'];
    verifiedByUserId: string | null;
    verifiedOn: Date | null;
    source: string | null;
    evidenceRef: string | null;
    reason: string | null;
    nextVerificationDate: Date | null;
  }): Promise<VerificationRecord>;
}

export interface AuditRepository {
  append(
    input: Omit<AuditEntry, 'id' | 'createdAt'> & { id: string; createdAt: Date },
  ): Promise<void>;
  listForEntity(entityType: string, entityId: string, limit: number): Promise<AuditEntry[]>;
  listRecent(limit: number): Promise<AuditEntry[]>;
}

export interface OutboxRepository {
  append(input: {
    id: string;
    eventType: string;
    eventVersion: number;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
    dedupeKey?: string | null;
  }): Promise<void>;
  claimBatch(limit: number, now: Date): Promise<OutboxEventRecord[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  /** Stops retrying a poison event; it stays visible on /admin/system/events. */
  markDeadLettered(
    id: string,
    error: string,
    deadLetteredAt: Date,
    attempts: number,
  ): Promise<void>;
}

/* --- Notifications -------------------------------------------------------- */

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  eventId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPreferenceRecord {
  type: string;
  inApp: boolean;
  email: boolean;
  updatedAt: Date | null;
}

export interface NotificationRepository {
  /** Returns false when this user already has this event's notification. */
  create(input: {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    entityType: string | null;
    entityId: string | null;
    eventId: string | null;
    createdAt: Date;
  }): Promise<boolean>;
  listForUser(
    userId: string,
    page: { skip: number; take: number },
    options?: { unreadOnly?: boolean },
  ): Promise<{ rows: NotificationRecord[]; total: number; unread: number }>;
  unreadCount(userId: string): Promise<number>;
  markRead(input: { userId: string; ids?: string[]; readAt: Date }): Promise<number>;
  preferences(userId: string): Promise<NotificationPreferenceRecord[]>;
  savePreferences(
    userId: string,
    values: Array<{ type: string; inApp: boolean; email: boolean }>,
    at: Date,
  ): Promise<void>;
  recipients(userId: string): Promise<{ id: string; email: string; role: Role } | null>;
}

/* --- Async CSV exports --------------------------------------------------- */

/** One requested export. `filters` is the validated request body stored as JSON. */
export interface ExportJobRecord {
  id: string;
  type: ExportType;
  status: ExportStatus;
  requestedByUserId: string;
  filters: Record<string, unknown>;
  rowCount: number | null;
  fileDocumentId: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  expiresAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

/** The private-storage object behind a finished export. */
export interface ExportFileRecord {
  id: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ExportRepository {
  createJob(input: {
    id: string;
    type: ExportType;
    requestedByUserId: string;
    filters: Record<string, unknown>;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<ExportJobRecord>;
  findJob(id: string): Promise<ExportJobRecord | null>;
  /**
   * Atomically claims the oldest queued job. `FOR UPDATE SKIP LOCKED` lets
   * several workers run at once; a job left RUNNING by a crashed worker is
   * reclaimed after 15 minutes.
   */
  claimNext(now: Date): Promise<ExportJobRecord | null>;
  completeJob(input: {
    id: string;
    file: { id: string; storageKey: string; fileName: string; mimeType: string; sizeBytes: number };
    rowCount: number;
    finishedAt: Date;
  }): Promise<void>;
  failJob(input: { id: string; error: string; finishedAt: Date }): Promise<void>;
  listForUser(
    userId: string,
    page: { skip: number; take: number },
  ): Promise<{ rows: ExportJobRecord[]; total: number }>;
  countActive(userId: string): Promise<number>;
  findFile(id: string): Promise<ExportFileRecord | null>;
  /** Marks finished jobs past their TTL as EXPIRED; returns keys to delete. */
  expireDue(now: Date): Promise<string[]>;
}

/* --- Operational visibility (outbox, jobs, webhooks) ---------------------- */

export interface OutboxAdminRow {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  attempts: number;
  occurredAt: Date;
  publishedAt: Date | null;
  deadLetteredAt: Date | null;
  nextAttemptAt: Date;
  lastError: string | null;
}

export interface JobRunRecord {
  id: string;
  queue: string;
  status: 'SUCCEEDED' | 'FAILED';
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface WebhookEndpointRecord {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface SystemRepository {
  outboxList(
    filters: { status: 'all' | 'pending' | 'published' | 'dead'; eventType: string | null },
    page: { skip: number; take: number },
  ): Promise<{ rows: OutboxAdminRow[]; total: number; deadCount: number }>;
  /** Clears the dead letter so the publisher picks the event up again. */
  outboxRetry(id: string, at: Date): Promise<boolean>;
  purgeOutbox(input: { publishedBefore: Date; deadBefore: Date }): Promise<number>;

  /** Handler-level idempotency: one row per (event, handler). */
  alreadyProcessed(eventId: string, handler: string): Promise<boolean>;
  markProcessed(eventId: string, handler: string, at: Date): Promise<void>;

  recordJobRun(input: Omit<JobRunRecord, 'durationMs'>): Promise<void>;
  listJobRuns(page: {
    skip: number;
    take: number;
  }): Promise<{ rows: JobRunRecord[]; total: number }>;

  webhookEndpoints(): Promise<WebhookEndpointRecord[]>;
  saveWebhookEndpoint(input: {
    id: string;
    url: string;
    description: string | null;
    eventTypes: string[];
    active: boolean;
  }): Promise<WebhookEndpointRecord>;
  deleteWebhookEndpoint(id: string): Promise<boolean>;
  createWebhookDelivery(input: {
    id: string;
    endpointId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: Date;
  }): Promise<boolean>;
  pendingWebhookDeliveries(limit: number, now: Date): Promise<WebhookDeliveryRecord[]>;
  markWebhookDelivered(id: string, at: Date): Promise<void>;
  markWebhookFailed(input: {
    id: string;
    error: string;
    attempts: number;
    nextAttemptAt: Date;
    status: 'PENDING' | 'FAILED';
  }): Promise<void>;

  /** Denormalized read model used by directory search. */
  refreshProviderSearchIndex(organizationId: string, at: Date): Promise<void>;
  removeProviderSearchIndex(organizationId: string): Promise<void>;
}

export interface UserCreateInput {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  mustChangePassword?: boolean;
}

/** The credential fields sign-in needs; never leaves the server. */
export interface UserAuthRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  passwordHash: string;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface UserRepository {
  findByEmail(email: string): Promise<(UserRecord & { passwordHash: string }) | null>;
  findForAuth(email: string): Promise<UserAuthRecord | null>;
  findAuthById(id: string): Promise<UserAuthRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: UserCreateInput): Promise<UserRecord>;
  list(options: { skip: number; take: number }): Promise<{ rows: UserRecord[]; total: number }>;
  softDelete(input: { id: string; deletedAt: Date }): Promise<UserRecord | null>;
  recordFailedLogin(input: {
    id: string;
    failedLoginCount: number;
    lockedUntil: Date | null;
  }): Promise<void>;
  recordSuccessfulLogin(input: { id: string; lastLoginAt: Date }): Promise<void>;
  setPassword(input: {
    id: string;
    passwordHash: string;
    mustChangePassword: boolean;
  }): Promise<void>;
  /** Active accounts with one role; used to address admin notifications. */
  listByRole(role: Role): Promise<UserRecord[]>;
}

export interface StaffListFilters {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
}

export interface StaffCreateInput {
  id: string;
  email: string;
  name: string;
  mobile: string | null;
  employeeCode: string | null;
  passwordHash: string;
  createdByUserId: string | null;
  pinCodes: string[];
}

export interface StaffUpdateInput {
  id: string;
  name?: string;
  mobile?: string | null;
  employeeCode?: string | null;
  /** Replaces the whole set when present. */
  pinCodes?: string[];
}

export interface StaffRepository {
  findById(id: string, options?: { includeDeleted?: boolean }): Promise<StaffMemberRecord | null>;
  findByEmail(email: string): Promise<StaffMemberRecord | null>;
  findByEmployeeCode(employeeCode: string): Promise<StaffMemberRecord | null>;
  list(
    filters: StaffListFilters,
    page: { skip: number; take: number },
  ): Promise<{ rows: StaffMemberRecord[]; total: number }>;
  create(input: StaffCreateInput): Promise<StaffMemberRecord>;
  update(input: StaffUpdateInput): Promise<StaffMemberRecord | null>;
  setStatus(input: {
    id: string;
    status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
    deletedAt?: Date | null;
  }): Promise<StaffMemberRecord | null>;
  /** Providers this person onboarded; 0 until they start working. */
  countProviders(staffUserId: string): Promise<number>;
}

export interface PasswordResetTokenRepository {
  create(input: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  /** Unused, unexpired token only. */
  findValid(tokenHash: string, now: Date): Promise<{ id: string; userId: string } | null>;
  markUsed(input: { id: string; usedAt: Date }): Promise<void>;
  invalidateForUser(input: { userId: string; usedAt: Date }): Promise<void>;
}

export interface SessionRepository {
  create(input: { id: string; userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findValidByTokenHash(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  /** Sliding expiry: bumps `last_seen_at` and the new `expires_at`. */
  touch(input: { id: string; lastSeenAt: Date; expiresAt: Date }): Promise<void>;
  /** Logout keeps the row for the audit trail but makes the token unusable. */
  revokeByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  /** "Sign out everywhere": every active session for the user. */
  revokeAllForUser(userId: string, revokedAt: Date): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}

/** The stored replay payload, exactly as the endpoint first returned it. */
export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  response: Record<string, unknown>;
  createdAt: Date;
}

export interface IdempotencyRepository {
  find(input: { userId: string; endpoint: string; key: string }): Promise<IdempotencyRecord | null>;
  save(input: {
    userId: string;
    endpoint: string;
    key: string;
    requestHash: string;
    response: Record<string, unknown>;
  }): Promise<void>;
}

// --- Master data ----------------------------------------------------------

/** Every list below is ordinary data: administrators edit it, not a deploy. */
export interface MasterListFilters {
  search?: string;
  providerType?: ProviderType;
  stateId?: string;
  /** Admin screens show retired rows too; the public lists do not. */
  includeInactive?: boolean;
}

export interface SpecialtyCreateInput {
  code: string;
  name: string;
  systemOfMedicine: string;
}

export interface SpecialtyUpdateInput extends Partial<SpecialtyCreateInput> {
  id: string;
  isActive?: boolean;
}

export interface CouncilCreateInput {
  code: string;
  name: string;
  kind: string;
  stateId: string | null;
}

export interface CouncilUpdateInput extends Partial<CouncilCreateInput> {
  id: string;
  isActive?: boolean;
}

export interface ServiceCategoryCreateInput {
  code: string;
  name: string;
  providerType: ProviderType;
}

export interface ServiceCategoryUpdateInput extends Partial<ServiceCategoryCreateInput> {
  id: string;
  isActive?: boolean;
}

export interface DocumentTypeCreateInput {
  code: string;
  name: string;
  providerTypes: ProviderType[];
  requiresExpiry: boolean;
  expiryReminderDays: number[];
}

export interface DocumentTypeUpdateInput extends Partial<DocumentTypeCreateInput> {
  id: string;
  isActive?: boolean;
}

export interface MasterDataRepository {
  states: {
    list(): Promise<StateRecord[]>;
  };
  districts: {
    list(stateId?: string): Promise<DistrictRecord[]>;
  };
  pincodes: {
    /** Prefix match on the PIN and on the office name. */
    search(input: { q: string; limit: number }): Promise<PincodeRecord[]>;
    findByPin(pinCode: string): Promise<PincodeRecord | null>;
    stats(): Promise<PincodeImportStats>;
  };
  specialties: {
    list(filters?: MasterListFilters): Promise<SpecialtyRecord[]>;
    findById(id: string): Promise<SpecialtyRecord | null>;
    findByCode(code: string): Promise<SpecialtyRecord | null>;
    create(input: SpecialtyCreateInput & { id: string }): Promise<SpecialtyRecord>;
    update(input: SpecialtyUpdateInput): Promise<SpecialtyRecord | null>;
  };
  councils: {
    list(filters?: MasterListFilters): Promise<CouncilRecord[]>;
    findById(id: string): Promise<CouncilRecord | null>;
    findByCode(code: string): Promise<CouncilRecord | null>;
    create(input: CouncilCreateInput & { id: string }): Promise<CouncilRecord>;
    update(input: CouncilUpdateInput): Promise<CouncilRecord | null>;
  };
  serviceCategories: {
    list(filters?: MasterListFilters): Promise<ServiceCategoryRecord[]>;
    findById(id: string): Promise<ServiceCategoryRecord | null>;
    findByCode(code: string): Promise<ServiceCategoryRecord | null>;
    create(input: ServiceCategoryCreateInput & { id: string }): Promise<ServiceCategoryRecord>;
    update(input: ServiceCategoryUpdateInput): Promise<ServiceCategoryRecord | null>;
  };
  documentTypes: {
    list(filters?: MasterListFilters): Promise<DocumentTypeRecord[]>;
    findById(id: string): Promise<DocumentTypeRecord | null>;
    findByCode(code: string): Promise<DocumentTypeRecord | null>;
    create(input: DocumentTypeCreateInput & { id: string }): Promise<DocumentTypeRecord>;
    update(input: DocumentTypeUpdateInput): Promise<DocumentTypeRecord | null>;
  };
  licenceTypes: {
    list(): Promise<LicenceTypeRecord[]>;
  };
  facilityTypes: {
    list(): Promise<FacilityTypeRecord[]>;
  };
}

/* --- Provider onboarding (normalized model) -------------------------------- */

export interface OrganizationCreateInput {
  id: string;
  providerType: ProviderType;
  legalName: string | null;
  tradeName: string | null;
  registrationNumber: string | null;
  website: string | null;
  email: string | null;
  mobile: string | null;
  primaryPinCode: string | null;
  typeData: Record<string, unknown>;
  createdByUserId: string;
}

/** Columns on `provider_organizations` a section save may touch. */
export interface OrganizationColumnPatch {
  legalName?: string | null;
  tradeName?: string | null;
  constitutionType?: string | null;
  registrationNumber?: string | null;
  establishedOn?: Date | null;
  website?: string | null;
  email?: string | null;
  mobile?: string | null;
  primaryPinCode?: string | null;
  primaryDistrictId?: string | null;
  primaryStateId?: string | null;
}

export interface OrganizationUpdateInput {
  id: string;
  expectedVersion: number;
  columns: OrganizationColumnPatch;
  typeData?: Record<string, unknown>;
  typeDataSchemaVersion?: number;
  profileData?: Record<string, unknown>;
  publicationConsents?: Record<string, unknown>;
}

export interface OrganizationTransitionInput {
  id: string;
  expectedVersion: number;
  fromStatus: OrganizationStatus;
  toStatus: OrganizationStatus;
  changedByUserId: string;
  reason: string | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedByUserId?: string | null;
}

export interface DuplicateCandidate {
  /** Owner of the matching provider, so a staff response can redact it. */
  createdByUserId?: string;
  id: string;
  code: string;
  legalName: string | null;
  providerType: ProviderType;
  status: OrganizationStatus;
  similarity?: number;
}

export interface OnboardingLocationInput {
  name: string;
  locationType: string;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city: string;
  districtId?: string | null;
  stateId?: string | null;
  pinCode: string;
  latitude?: number | null;
  longitude?: number | null;
  isPrimary?: boolean;
  isPublic?: boolean;
  operatingHours?: Record<string, unknown>;
  bookingPhone?: string | null;
  branchRef?: string | null;
}

export type OnboardingLocationPatch = Partial<OnboardingLocationInput>;

export interface OnboardingContactInput {
  role: string;
  name: string;
  designation?: string | null;
  phone: string;
  email?: string | null;
  address?: Record<string, unknown> | null;
}

export interface OnboardingLicenceInput {
  role?: string | null;
  licenceTypeId?: string | null;
  locationId?: string | null;
  number: string;
  authority?: string | null;
  issuedOn?: Date | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  status?: string;
  documentId?: string | null;
  details?: Record<string, unknown>;
}

export type OnboardingLicencePatch = Partial<OnboardingLicenceInput>;

export interface OnboardingInsuranceInput {
  type: string;
  insurer: string;
  policyNo: string;
  limitPaise?: number | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  documentId?: string | null;
}

export type OnboardingInsurancePatch = Partial<OnboardingInsuranceInput>;

export interface DoctorProfileWriteInput {
  organizationId: string | null;
  createdByOrgId: string | null;
  fullName: string;
  mobile?: string | null;
  email?: string | null;
  registrationNo: string;
  councilId?: string | null;
  councilName?: string | null;
  systemOfMedicine: string;
  specialtyId?: string | null;
  specialtyName?: string | null;
  qualifications?: Array<Record<string, unknown>>;
  photoDocumentId?: string | null;
  status?: DoctorProfileRecord['status'];
}

export type DoctorProfilePatch = Partial<DoctorProfileWriteInput>;

export interface DoctorPracticeWriteInput {
  doctorProfileId: string;
  clinicOrganizationId?: string | null;
  roleAtClinic?: string | null;
  practiceType?: string | null;
  address?: Record<string, unknown> | null;
  publicContact?: string | null;
  timings: Array<Record<string, unknown>>;
  feePaise?: number | null;
  status?: string;
}

export type DoctorPracticePatch = Partial<Omit<DoctorPracticeWriteInput, 'doctorProfileId'>>;

export interface OnboardingDocumentInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey?: string | null;
  role?: string | null;
  uploadedByUserId: string;
}

export interface ProviderOnboardingRepository {
  createOrganization(input: OrganizationCreateInput): Promise<ProviderOrganizationRecord>;
  /** Newest first; staff pass their own user id, administrators omit it. */
  listOrganizations(filter: {
    createdByUserId?: string;
    limit?: number;
  }): Promise<ProviderOrganizationRecord[]>;
  findOrganizationById(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ProviderOrganizationRecord | null>;
  updateOrganization(input: OrganizationUpdateInput): Promise<ProviderOrganizationRecord | null>;
  transitionOrganization(
    input: OrganizationTransitionInput,
  ): Promise<ProviderOrganizationRecord | null>;

  listStatusHistory(organizationId: string, limit: number): Promise<ProviderStatusHistoryRecord[]>;
  appendStatusHistory(input: {
    id: string;
    organizationId: string;
    fromStatus: OrganizationStatus | null;
    toStatus: OrganizationStatus;
    changedByUserId: string;
    reason: string | null;
    scope?: SuspensionScope | null;
    scopeRefId?: string | null;
    scopeLabel?: string | null;
    flaggedSections?: string[];
    at: Date;
  }): Promise<void>;

  listLocations(organizationId: string): Promise<ProviderLocationRecord[]>;
  createLocation(
    organizationId: string,
    input: OnboardingLocationInput,
    id: string,
  ): Promise<ProviderLocationRecord>;
  /** Scoped by organization so a location id from another provider cannot be edited. */
  updateLocation(
    organizationId: string,
    locationId: string,
    patch: OnboardingLocationPatch,
  ): Promise<ProviderLocationRecord | null>;
  deleteLocation(organizationId: string, locationId: string): Promise<boolean>;
  clearPrimaryLocations(organizationId: string, exceptId?: string): Promise<void>;

  listContacts(organizationId: string): Promise<ProviderContactRecord[]>;
  upsertContact(
    organizationId: string,
    input: OnboardingContactInput,
    id: string,
  ): Promise<ProviderContactRecord>;
  deleteContact(organizationId: string, contactId: string): Promise<boolean>;

  listLicences(organizationId: string): Promise<ProviderLicenceRecord[]>;
  createLicence(
    organizationId: string,
    input: OnboardingLicenceInput,
    id: string,
  ): Promise<ProviderLicenceRecord>;
  updateLicence(
    organizationId: string,
    licenceId: string,
    patch: OnboardingLicencePatch,
  ): Promise<ProviderLicenceRecord | null>;
  deleteLicence(organizationId: string, licenceId: string): Promise<boolean>;

  listInsurance(organizationId: string): Promise<ProviderInsuranceRecord[]>;
  createInsurance(
    organizationId: string,
    input: OnboardingInsuranceInput,
    id: string,
  ): Promise<ProviderInsuranceRecord>;
  updateInsurance(
    organizationId: string,
    insuranceId: string,
    patch: OnboardingInsurancePatch,
  ): Promise<ProviderInsuranceRecord | null>;
  deleteInsurance(organizationId: string, insuranceId: string): Promise<boolean>;

  listServicePins(organizationId: string): Promise<ProviderServicePinRecord[]>;
  addServicePin(
    organizationId: string,
    input: { pinCode: string; serviceKind: string },
    id: string,
  ): Promise<ProviderServicePinRecord>;
  removeServicePin(organizationId: string, pinId: string): Promise<boolean>;

  listDocuments(organizationId: string): Promise<ProviderDocumentRecord[]>;
  createDocument(
    organizationId: string,
    input: OnboardingDocumentInput,
    id: string,
  ): Promise<ProviderDocumentRecord>;
  deleteDocument(organizationId: string, documentId: string, deletedAt: Date): Promise<boolean>;

  /** `ownerUserId` limits matches to providers that user onboarded (staff scope). */
  findByRegistrationNumber(
    registrationNumber: string,
    excludeOrganizationId: string | null,
    ownerUserId?: string | null,
  ): Promise<DuplicateCandidate[]>;
  findByLicenceNumber(
    licenceNumber: string,
    excludeOrganizationId: string | null,
    ownerUserId?: string | null,
  ): Promise<DuplicateCandidate[]>;
  findByMobileAndPin(
    mobile: string,
    pinCode: string,
    excludeOrganizationId: string | null,
    ownerUserId?: string | null,
  ): Promise<DuplicateCandidate[]>;
  findSimilarLegalName(
    legalName: string,
    pinCode: string,
    excludeOrganizationId: string | null,
    ownerUserId?: string | null,
  ): Promise<DuplicateCandidate[]>;
  findDoctorRegistration(
    registrationNo: string,
    councilId: string | null,
  ): Promise<Array<{ id: string; organizationId: string | null }>>;

  // --- Doctor profile, practices and clinic links (field-spec 4 and 6.5) ---
  findDoctorProfileByOrganizationId(organizationId: string): Promise<DoctorProfileRecord | null>;
  findDoctorProfileById(id: string): Promise<DoctorProfileRecord | null>;
  findDoctorProfilesByRegistration(registrationNo: string): Promise<DoctorProfileRecord[]>;
  saveDoctorProfile(input: DoctorProfileWriteInput, id?: string): Promise<DoctorProfileRecord>;

  listDoctorPractices(doctorProfileId: string): Promise<DoctorLocationRecord[]>;
  createDoctorPractice(input: DoctorPracticeWriteInput, id: string): Promise<DoctorLocationRecord>;
  updateDoctorPractice(
    doctorProfileId: string,
    practiceId: string,
    patch: DoctorPracticePatch,
  ): Promise<DoctorLocationRecord | null>;
  deleteDoctorPractice(doctorProfileId: string, practiceId: string): Promise<boolean>;

  listClinicDoctorLinks(clinicOrganizationId: string): Promise<ClinicDoctorLinkRecord[]>;
  createClinicDoctorLink(
    input: DoctorPracticeWriteInput & { clinicOrganizationId: string; roleAtClinic: string },
    id: string,
  ): Promise<ClinicDoctorLinkRecord>;
  updateClinicDoctorLink(
    clinicOrganizationId: string,
    linkId: string,
    patch: { roleAtClinic?: string; timings?: Array<Record<string, unknown>>; feePaise?: number },
  ): Promise<ClinicDoctorLinkRecord | null>;
  deleteClinicDoctorLink(clinicOrganizationId: string, linkId: string): Promise<boolean>;

  dismissDuplicate(input: {
    id: string;
    organizationId: string;
    duplicateOrganizationId: string;
    dismissedByUserId: string;
    reason: string | null;
    at: Date;
  }): Promise<void>;
  listDismissedDuplicateIds(organizationId: string): Promise<string[]>;
}

export interface DocumentRepository {
  create(input: DocumentCreateInput): Promise<DocumentRecord>;
  findById(id: string, options?: { includeDeleted?: boolean }): Promise<DocumentRecord | null>;
  listByOwner(ownerType: DocumentOwnerType, ownerId: string): Promise<DocumentRecord[]>;
  update(id: string, patch: DocumentUpdatePatch): Promise<DocumentRecord | null>;
  softDelete(id: string, deletedAt: Date): Promise<boolean>;
  /** Live documents that expire before `before`, soonest first (expiry job). */
  listExpiring(before: Date, limit: number): Promise<DocumentExpiryCandidate[]>;
  /** Licences with `valid_to` before `before`, soonest first. */
  listLicencesExpiring(before: Date, limit: number): Promise<LicenceExpiryCandidate[]>;
  /** Marks an expired document EXPIRED; false when it was already expired. */
  markExpired(id: string, at: Date): Promise<boolean>;
  /** Raises or clears the provider compliance flag after an expiry event. */
  setComplianceFlag(input: {
    organizationId: string;
    flagged: boolean;
    reason: string | null;
  }): Promise<void>;
}

/** One document the expiry scan may remind about or expire. */
export interface DocumentExpiryCandidate {
  documentId: string;
  organizationId: string;
  documentTypeCode: string;
  documentTypeName: string;
  expiresOn: Date;
  reminderDays: number[];
  status: DocumentRecord['status'];
  uploadedByUserId: string;
  fileName: string;
}

export interface LicenceExpiryCandidate {
  licenceId: string;
  organizationId: string;
  licenceNumber: string;
  licenceTypeName: string | null;
  validTo: Date;
  reminderDays: number[];
}

export interface ProviderDirectoryRepository {
  /** One indexed SQL statement: filters, stable sort, page, total and facets. */
  search(
    filters: AdminProviderFilters,
    page: { skip: number; take: number },
    sort: { field: AdminProviderSortField; order: 'asc' | 'desc' },
  ): Promise<{ rows: AdminProviderDirectoryRow[]; total: number }>;
  /** Type and status counts under the same filters. */
  facets(filters: AdminProviderFilters): Promise<AdminProviderFacets>;
  listViews(userId: string): Promise<ProviderDirectoryViewRecord[]>;
  saveView(input: {
    id: string;
    userId: string;
    name: string;
    query: string;
  }): Promise<ProviderDirectoryViewRecord>;
  deleteView(userId: string, id: string): Promise<boolean>;
}

/* --- Consents, agreements and confirmation links -------------------------- */

export interface ConsentRecord {
  id: string;
  organizationId: string;
  doctorProfileId: string | null;
  consentType: ConsentType;
  textVersion: string;
  capturedByUserId: string | null;
  capturedAt: Date;
  method: ConsentMethod;
  evidenceDocumentId: string | null;
  confirmationMeta: Record<string, unknown>;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AgreementTemplateStatus = 'draft' | 'active' | 'retired';

export interface AgreementTemplateRecord {
  id: string;
  providerType: ProviderType;
  name: string;
  version: string;
  effectiveFrom: Date;
  body: string;
  bodyHash: string;
  fileDocumentId: string | null;
  status: AgreementTemplateStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgreementAcceptanceRecord {
  id: string;
  organizationId: string;
  templateId: string;
  method: ConsentMethod;
  signedOn: Date;
  place: string;
  signatoryName: string;
  signatoryDesignation: string;
  signedDocumentId: string | null;
  stampReference: string | null;
  witnesses: Array<Record<string, unknown>>;
  recordedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  templateName: string | null;
  templateVersion: string | null;
}

export interface ConfirmationRequestRecord {
  id: string;
  organizationId: string;
  doctorProfileId: string | null;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  confirmationMeta: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface ConsentRepository {
  createConsent(input: Omit<ConsentRecord, 'createdAt' | 'updatedAt'>): Promise<ConsentRecord>;
  listByOrganization(organizationId: string): Promise<ConsentRecord[]>;
  findById(id: string): Promise<ConsentRecord | null>;
  revoke(input: {
    id: string;
    revokedAt: Date;
    revokedByUserId: string;
    reason: string;
  }): Promise<ConsentRecord | null>;

  listAgreements(organizationId: string): Promise<AgreementAcceptanceRecord[]>;
  createAgreement(
    input: Omit<
      AgreementAcceptanceRecord,
      'createdAt' | 'updatedAt' | 'templateName' | 'templateVersion'
    >,
  ): Promise<AgreementAcceptanceRecord>;
  listTemplates(providerType?: ProviderType): Promise<AgreementTemplateRecord[]>;
  findTemplate(id: string): Promise<AgreementTemplateRecord | null>;
  saveTemplate(
    input: Pick<
      AgreementTemplateRecord,
      'id' | 'providerType' | 'name' | 'version' | 'effectiveFrom' | 'body' | 'bodyHash'
    >,
  ): Promise<AgreementTemplateRecord>;

  createConfirmationRequest(
    input: Omit<ConfirmationRequestRecord, 'createdAt'>,
  ): Promise<ConfirmationRequestRecord>;
  findConfirmationRequestByTokenHash(tokenHash: string): Promise<ConfirmationRequestRecord | null>;
  listConfirmationRequests(organizationId: string): Promise<ConfirmationRequestRecord[]>;
  updateConfirmationRequest(
    id: string,
    patch: {
      usedAt?: Date | null;
      revokedAt?: Date | null;
      confirmationMeta?: Record<string, unknown>;
    },
  ): Promise<ConfirmationRequestRecord>;

  /** Called when the doctor confirms through a clinic invite or the public link. */
  markDoctorConfirmed(doctorProfileId: string, confirmedAt: Date): Promise<void>;
}

/**
 * Read models for the staff dashboard, always scoped to the owner passed in.
 * Nothing here can be called without an owning user id.
 */
export interface StaffWorkspaceRepository {
  /** Latest change-request comment per returned provider, newest first. */
  changeRequests(ownerUserId: string, limit: number): Promise<StaffChangeRequestRecord[]>;
  /** Change-request comments for a page of providers, for inline notes. */
  changeRequestsFor(
    ownerUserId: string,
    organizationIds: string[],
  ): Promise<StaffChangeRequestRecord[]>;
  /** Licences and insurance policies expiring before `before`, soonest first. */
  expiring(ownerUserId: string, before: Date, limit: number): Promise<StaffExpiryRecord[]>;
  recentActivity(ownerUserId: string, limit: number): Promise<StaffActivityRecord[]>;
  /** `[{ month: 'YYYY-MM', count }]` since `from`, oldest first. */
  monthlyCounts(ownerUserId: string, from: Date): Promise<Array<{ month: string; count: number }>>;
}

export interface Repositories {
  providers: ProviderRepository;
  directory: ProviderDirectoryRepository;
  documents: DocumentRepository;
  onboarding: ProviderOnboardingRepository;
  master: MasterDataRepository;
  verifications: VerificationRepository;
  audits: AuditRepository;
  outbox: OutboxRepository;
  users: UserRepository;
  staff: StaffRepository;
  sessions: SessionRepository;
  idempotency: IdempotencyRepository;
  passwordResets: PasswordResetTokenRepository;
  consents: ConsentRepository;
  staffWorkspace: StaffWorkspaceRepository;
  analytics: AnalyticsRepository;
  reviews: ReviewRepository;
  notifications: NotificationRepository;
  system: SystemRepository;
  exports: ExportRepository;
}

/** Admin review workflow persistence (queue, checklist, comments, assignment). */
export interface ReviewRepository {
  queue(
    filters: {
      providerTypes: ProviderType[];
      pin: string | null;
      staffUserId: string | null;
      assignedToUserId: string | null;
    },
    page: number,
    pageSize: number,
  ): Promise<{
    rows: Array<{
      id: string;
      code: string;
      legalName: string | null;
      providerType: ProviderType;
      status: OrganizationStatus;
      primaryPinCode: string | null;
      submittedAt: Date | null;
      staff: { id: string; name: string; email: string } | null;
      assignedTo: { id: string; name: string } | null;
      checklist: ReviewChecklistProgress;
    }>;
    total: number;
  }>;
  settings(): Promise<{ warnHours: number; breachHours: number; updatedAt: Date | null }>;
  saveSettings(
    input: { warnHours: number; breachHours: number },
    userId: string,
  ): Promise<{ warnHours: number; breachHours: number; updatedAt: Date | null }>;
  assign(organizationId: string, reviewerUserId: string, assignedByUserId: string): Promise<void>;
  assignment(
    organizationId: string,
  ): Promise<{ reviewerUserId: string; reviewerName: string; assignedAt: Date } | null>;
  verifications(organizationId: string): Promise<ReviewVerificationDto[]>;
  doctorVerifications(doctorProfileId: string): Promise<ReviewVerificationDto[]>;
  seed(
    organizationId: string,
    items: Array<{ code: string; label: string; sectionKey: string; required: boolean }>,
  ): Promise<number>;
  seedDoctor(
    doctorProfileId: string,
    items: Array<{ code: string; label: string; sectionKey: string; required: boolean }>,
  ): Promise<number>;
  updateVerification(
    organizationId: string,
    item: string,
    input: ReviewVerificationUpdate,
    actorUserId: string,
    at: Date,
  ): Promise<ReviewVerificationDto>;
  resetItems(organizationId: string, items: string[]): Promise<number>;
  comments(organizationId: string): Promise<ReviewCommentDto[]>;
  addComment(input: {
    id: string;
    organizationId: string;
    sectionKey: string;
    authorUserId: string;
    authorRole: string;
    body: string;
    at: Date;
  }): Promise<ReviewCommentDto>;
  lastSuspension(organizationId: string): Promise<{
    scope: SuspensionScope | null;
    scopeLabel: string | null;
    reason: string | null;
  } | null>;
}

/** Read-only admin analytics over the provider directory and PIN read model. */
export interface AnalyticsRepository {
  pinSummary(
    filters: AnalyticsFilters,
    options: {
      groupBy: AnalyticsGroupBy;
      page: number;
      pageSize: number;
      sort: 'pin_code' | 'total' | 'approved';
      order: 'asc' | 'desc';
      q: string | null;
      gapsOnly: boolean;
      /** Read the maintained table when no extra dimension is requested. */
      useStats: boolean;
      measure: PinStatMeasure;
    },
  ): Promise<AnalyticsPinSummary>;
  overview(filters: AnalyticsFilters, days: number): Promise<AnalyticsOverview>;
  staffPerformance(
    filters: AnalyticsFilters,
    page: number,
    pageSize: number,
  ): Promise<StaffPerformanceResult>;
  /** PIN directory rows with no approved provider, honouring the filters. */
  coverageGaps(
    filters: AnalyticsFilters,
    q: string | null,
    page: number,
    pageSize: number,
  ): Promise<AnalyticsPinSummary>;
}

/** Port for running multi-table writes in a single database transaction. */
export interface UnitOfWork {
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
