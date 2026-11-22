import type {
  ProviderStatus,
  ProviderType,
  Role,
  VerificationItem,
  VerificationStatus,
} from './enums';

/** Provider form payload: flat field keys from docs/field-spec.md (see field registry). */
export type ProviderData = Record<string, unknown>;

export interface ProviderRecord {
  id: string;
  providerType: ProviderType;
  status: ProviderStatus;
  displayName: string | null;
  legalName: string | null;
  data: ProviderData;
  primaryPinCode: string | null;
  city: string | null;
  version: number;
  createdByUserId: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  decisionReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderRevisionRecord {
  id: string;
  providerId: string;
  version: number;
  status: ProviderStatus;
  changedByUserId: string;
  changedFieldKeys: string[];
  createdAt: Date;
}

export interface ProviderPin {
  pinCode: string;
  kind: 'registered_office' | 'location' | 'service_area';
}

export interface ProviderPinRecord extends ProviderPin {
  providerId: string;
}

export interface VerificationRecord {
  id: string;
  providerId: string;
  item: VerificationItem;
  status: VerificationStatus;
  verifiedByUserId: string | null;
  verifiedOn: Date | null;
  source: string | null;
  evidenceRef: string | null;
  reason: string | null;
  nextVerificationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}

/** A staff account as the admin directory sees it (never carries the hash). */
export interface StaffMemberRecord {
  id: string;
  email: string;
  name: string;
  mobile: string | null;
  employeeCode: string | null;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  mustChangePassword: boolean;
  /** Territory reference only; it does not restrict access. */
  pinCodes: string[];
  createdByUserId: string | null;
  lastLoginAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  /** Session start, used for the 24-hour absolute cap on sliding expiry. */
  createdAt: Date;
  lastSeenAt: Date | null;
  role: Role;
  user: UserRecord;
  /** Set while the account is still on a temporary password. */
  mustChangePassword: boolean;
}

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string | null;
  changedFieldKeys: string[];
  fromStatus: ProviderStatus | null;
  toStatus: ProviderStatus | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface OutboxEventRecord {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  publishedAt: Date | null;
  attempts: number;
  lastError: string | null;
  dedupeKey: string | null;
}

/** --- Master data --------------------------------------------------------- */

export interface StateRecord {
  id: string;
  code: string;
  name: string;
}

export interface DistrictRecord {
  id: string;
  stateId: string;
  name: string;
  stateCode: string;
}

export interface PincodeRecord {
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

export interface SpecialtyRecord {
  id: string;
  code: string;
  name: string;
  systemOfMedicine: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LicenceTypeRecord {
  id: string;
  code: string;
  name: string;
  applicableProviderTypes: ProviderType[];
  isActive: boolean;
}

export interface CouncilRecord {
  id: string;
  code: string;
  name: string;
  kind: string;
  stateId: string | null;
  stateName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceCategoryRecord {
  id: string;
  code: string;
  name: string;
  providerType: ProviderType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilityTypeRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface DocumentTypeRecord {
  id: string;
  code: string;
  name: string;
  providerTypes: ProviderType[];
  requiresExpiry: boolean;
  expiryReminderDays: number[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PincodeImportStats {
  totalPins: number;
  totalDistricts: number;
  lastUpdatedAt: Date | null;
}

export interface PageRequest {
  page: number;
  pageSize: number;
}

export type ProviderSortField =
  'createdAt' | 'updatedAt' | 'displayName' | 'status' | 'providerType';

export interface ProviderSort {
  field: ProviderSortField;
  order: 'asc' | 'desc';
}
