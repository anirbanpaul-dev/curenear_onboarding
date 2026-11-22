import { randomUUID } from 'node:crypto';
import {
  createPersistence,
  getPrismaClient,
  importPincodes,
  indiaPostPincodeMapping,
} from '@curenear/db';
import { getServerEnv } from '@curenear/shared';
import { createAuthService } from './auth-service';
import { createDocumentService } from './document-service';
import { createExportService } from './export-service';
import { createS3ObjectStorage } from '@/server/documents/object-storage';
import { createScanProvider } from '@/server/documents/scan';
import { createAdminDirectoryService } from './admin-directory-service';
import { createAnalyticsService } from './analytics-service';
import { createMasterService } from './master-service';
import { createNotificationService } from './notification-service';
import { createSystemService } from './system-service';
import { createProviderOnboardingService } from './provider-onboarding-service';
import { createReviewService } from './review-service';
import { createConsentService } from './consent-service';
import { createStaffService } from './staff-service';
import { createStaffWorkspaceService } from './staff-workspace-service';
import { createUserService } from './user-service';
import { createSmtpEmailService } from '@/server/email';
import { createInMemoryRateLimiter } from '@/server/auth/rate-limiter';

let cached: ReturnType<typeof build> | null = null;

function build() {
  const env = getServerEnv();
  const persistence = createPersistence(getPrismaClient());
  const deps = {
    repositories: persistence.repositories,
    unitOfWork: persistence.unitOfWork,
    now: () => new Date(),
    newId: () => randomUUID(),
  };

  const email = createSmtpEmailService({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.SMTP_FROM,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
  });

  const onboarding = createProviderOnboardingService(deps);

  return {
    directory: createAdminDirectoryService(deps),
    analytics: createAnalyticsService(deps),
    onboarding,
    reviews: createReviewService({ ...deps, onboarding, email }),
    staffWorkspace: createStaffWorkspaceService({
      repositories: deps.repositories,
      now: deps.now,
      onboarding,
    }),
    consents: createConsentService({
      ...deps,
      appUrl: env.APP_URL,
      environment: env.NODE_ENV,
      confirmationLinksEnabled: env.PUBLIC_CONFIRMATION_LINK_ENABLED,
      storage: createS3ObjectStorage(),
    }),
    documents: createDocumentService({
      ...deps,
      storage: createS3ObjectStorage(),
      scanner: createScanProvider(env.DOCUMENT_SCAN_ENABLED),
      scanEnabled: env.DOCUMENT_SCAN_ENABLED,
    }),
    users: createUserService(deps),
    notifications: createNotificationService(deps),
    system: createSystemService(deps),
    exports: createExportService({
      ...deps,
      storage: createS3ObjectStorage(),
      appUrl: env.APP_URL,
      retentionHours: env.EXPORT_RETENTION_HOURS,
    }),
    staff: createStaffService({ ...deps, email, appUrl: env.APP_URL }),
    master: createMasterService({
      ...deps,
      // The browser upload runs the same importer as scripts/import-pincodes.ts.
      importPincodesFile: ({ csvText, dryRun }) =>
        importPincodes(getPrismaClient(), {
          mapping: indiaPostPincodeMapping,
          csvText,
          dryRun,
        }),
    }),
    auth: createAuthService({
      repositories: deps.repositories,
      now: deps.now,
      newId: deps.newId,
      appUrl: env.APP_URL,
      email,
      // Swap for Redis when the portal runs on more than one node.
      rateLimiter: createInMemoryRateLimiter(),
    }),
  };
}

/** Lazily built so importing route modules does not require DATABASE_URL. */
export function getServices(): ReturnType<typeof build> {
  if (!cached) cached = build();
  return cached;
}

export type Services = ReturnType<typeof getServices>;
