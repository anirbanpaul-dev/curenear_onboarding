import type {
  AuditLog as PrismaAuditLog,
  OutboxEvent as PrismaOutboxEvent,
  Provider as PrismaProvider,
  ProviderRevision as PrismaProviderRevision,
  Session as PrismaSession,
  User as PrismaUser,
  VerificationRecord as PrismaVerificationRecord,
} from '@prisma/client';
import type {
  AuditEntry,
  OutboxEventRecord,
  ProviderRecord,
  ProviderRevisionRecord,
  ProviderStatus,
  ProviderType,
  Role,
  SessionRecord,
  StaffMemberRecord,
  UserRecord,
  VerificationItem,
  VerificationRecord,
  VerificationStatus,
} from '@curenear/shared';

export function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function mapProvider(row: PrismaProvider): ProviderRecord {
  return {
    id: row.id,
    providerType: row.providerType as ProviderType,
    status: row.status as ProviderStatus,
    displayName: row.displayName,
    legalName: row.legalName,
    data: toJsonObject(row.data),
    primaryPinCode: row.primaryPinCode,
    city: row.city,
    version: row.version,
    createdByUserId: row.createdByUserId,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    decisionReason: row.decisionReason,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapRevision(row: PrismaProviderRevision): ProviderRevisionRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    version: row.version,
    status: row.status as ProviderStatus,
    changedByUserId: row.changedByUserId,
    changedFieldKeys: row.changedFieldKeys,
    createdAt: row.createdAt,
  };
}

export function mapUser(row: PrismaUser): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    isActive: row.status === 'ACTIVE',
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export function mapStaff(
  row: PrismaUser & { pinAssignments?: Array<{ pinCode: string }> },
): StaffMemberRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mobile: row.mobile,
    employeeCode: row.employeeCode,
    role: row.role as Role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    pinCodes: (row.pinAssignments ?? []).map((pin) => pin.pinCode.trim()),
    createdByUserId: row.createdByUserId,
    lastLoginAt: row.lastLoginAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function mapSession(row: PrismaSession & { user: PrismaUser }): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    role: row.user.role as Role,
    user: mapUser(row.user),
    mustChangePassword: row.user.mustChangePassword,
  };
}

export function mapAudit(row: PrismaAuditLog): AuditEntry {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorRole: (row.actorRole as Role | null) ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    requestId: row.requestId,
    changedFieldKeys: row.changedFieldKeys,
    fromStatus: (row.fromStatus as ProviderStatus | null) ?? null,
    toStatus: (row.toStatus as ProviderStatus | null) ?? null,
    reason: row.reason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

export function mapOutboxEvent(row: PrismaOutboxEvent): OutboxEventRecord {
  return {
    id: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: toJsonObject(row.payload),
    occurredAt: row.occurredAt,
    publishedAt: row.publishedAt,
    attempts: row.attempts,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey,
  };
}

export function mapVerification(row: PrismaVerificationRecord): VerificationRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    item: row.item as VerificationItem,
    status: row.status as VerificationStatus,
    verifiedByUserId: row.verifiedByUserId,
    verifiedOn: row.verifiedOn,
    source: row.source,
    evidenceRef: row.evidenceRef,
    reason: row.reason,
    nextVerificationDate: row.nextVerificationDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
