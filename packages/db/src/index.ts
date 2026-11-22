import type { Repositories, UnitOfWork } from '@curenear/shared';
import type { PrismaClient } from '@prisma/client';
import { getPrismaClient, type DbClient } from './client';
import { createAuditRepository } from './repositories/audit';
import { createConsentRepository } from './repositories/consents';
import { createStaffWorkspaceRepository } from './repositories/staff-workspace';
import { createProviderDirectoryRepository } from './repositories/admin-directory';
import { createAnalyticsRepository } from './repositories/analytics';
import { createReviewRepository } from './repositories/reviews';
import { createNotificationRepository } from './repositories/notifications';
import { createExportRepository } from './repositories/exports';
import { createSystemRepository } from './repositories/system';
import { createDocumentRepository } from './repositories/documents';
import { createIdempotencyRepository } from './repositories/idempotency';
import { createMasterDataRepository } from './repositories/master';
import { createOutboxRepository } from './repositories/outbox';
import { createPasswordResetRepository } from './repositories/password-resets';
import { createProviderRepository } from './repositories/providers';
import { createProviderOnboardingRepository } from './repositories/provider-onboarding';
import { createSessionRepository } from './repositories/sessions';
import { createStaffRepository } from './repositories/staff';
import { createUserRepository } from './repositories/users';
import { createVerificationRepository } from './repositories/verifications';

export type { DbClient } from './client';
export type { PrismaClient } from '@prisma/client';
export { createPrismaClient, disconnectPrisma, getPrismaClient } from './client';
export {
  hashPassword,
  hashSessionToken,
  generateSessionToken,
  generateResetToken,
  generateTemporaryPassword,
  hashResetToken,
  verifyPassword,
  passwordNeedsRehash,
  getDummyPasswordHash,
} from './password';
export { toJsonObject } from './mappers';
export { withTransaction, writeAudit, emitEvent } from './transactions';
export type { Tx, AuditEntryInput, OutboxEventInput } from './transactions';
export { seedReferenceData } from './reference-seed';
export type { ReferenceSeedCounts } from './reference-seed';
export {
  normalizeStateName,
  stateSeeds,
  councilSeeds,
  specialtySeeds,
  serviceCategorySeeds,
  facilityTypeSeeds,
  licenceTypeSeeds,
  documentTypeSeeds,
} from './reference-data';
export {
  importPincodes,
  parseCsv,
  indiaPostPincodeMapping,
  PincodeCsvError,
} from './pincode-import';
export type {
  PincodeCsvMapping,
  ImportPincodesOptions,
  ImportPincodesResult,
  CsvTable,
} from './pincode-import';
export { nextProviderCode } from './repositories/provider-directory';
export {
  rebuildProviderPinStats,
  recomputeProviderPinStats,
  checkProviderPinStats,
} from './repositories/pin-stats';
export type { PinStatsDrift } from './repositories/pin-stats';

export function createRepositories(db: DbClient): Repositories {
  return {
    providers: createProviderRepository(db),
    directory: createProviderDirectoryRepository(db),
    documents: createDocumentRepository(db),
    onboarding: createProviderOnboardingRepository(db),
    master: createMasterDataRepository(db),
    verifications: createVerificationRepository(db),
    audits: createAuditRepository(db),
    outbox: createOutboxRepository(db),
    users: createUserRepository(db),
    staff: createStaffRepository(db),
    sessions: createSessionRepository(db),
    idempotency: createIdempotencyRepository(db),
    passwordResets: createPasswordResetRepository(db),
    consents: createConsentRepository(db),
    staffWorkspace: createStaffWorkspaceRepository(db),
    analytics: createAnalyticsRepository(db),
    reviews: createReviewRepository(db),
    notifications: createNotificationRepository(db),
    system: createSystemRepository(db),
    exports: createExportRepository(db),
  };
}

/** Repositories plus a transaction runner that keeps all writes atomic. */
export function createPersistence(db: PrismaClient): {
  repositories: Repositories;
  unitOfWork: UnitOfWork;
} {
  return {
    repositories: createRepositories(db),
    unitOfWork: {
      transaction: (work) =>
        db.$transaction((tx) => work(createRepositories(tx)), {
          maxWait: 5_000,
          timeout: 20_000,
        }),
    },
  };
}

/** Convenience for scripts and the worker. */
export function createPersistenceFromEnv(): {
  db: PrismaClient;
  repositories: Repositories;
  unitOfWork: UnitOfWork;
} {
  const db = getPrismaClient();
  return { db, ...createPersistence(db) };
}
