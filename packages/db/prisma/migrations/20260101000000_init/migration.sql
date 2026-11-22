-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('doctor', 'clinic', 'pharmacy', 'diagnostic_centre', 'care_provider');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('draft', 'submitted', 'under_review', 'changes_requested', 'approved_not_live', 'live', 'suspended', 'rejected', 'terminated');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'rejected', 'expired', 'not_applicable');

-- CreateEnum
CREATE TYPE "PinKind" AS ENUM ('registered_office', 'location', 'service_area');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" UUID NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'draft',
    "displayName" TEXT,
    "legalName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "primaryPinCode" CHAR(6),
    "city" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "decisionReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPinCode" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "pinCode" CHAR(6) NOT NULL,
    "kind" "PinKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPinCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRevision" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProviderStatus" NOT NULL,
    "changedByUserId" UUID NOT NULL,
    "changedFieldKeys" TEXT[],
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "verifiedByUserId" UUID,
    "verifiedOn" TIMESTAMP(3),
    "source" TEXT,
    "evidenceRef" TEXT,
    "reason" TEXT,
    "nextVerificationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestId" TEXT,
    "changedFieldKeys" TEXT[],
    "fromStatus" "ProviderStatus",
    "toStatus" "ProviderStatus",
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Provider_providerType_idx" ON "Provider"("providerType");

-- CreateIndex
CREATE INDEX "Provider_status_idx" ON "Provider"("status");

-- CreateIndex
CREATE INDEX "Provider_createdByUserId_idx" ON "Provider"("createdByUserId");

-- CreateIndex
CREATE INDEX "Provider_primaryPinCode_idx" ON "Provider"("primaryPinCode");

-- CreateIndex
CREATE INDEX "Provider_city_idx" ON "Provider"("city");

-- CreateIndex
CREATE INDEX "Provider_deletedAt_idx" ON "Provider"("deletedAt");

-- CreateIndex
CREATE INDEX "Provider_createdAt_idx" ON "Provider"("createdAt");

-- CreateIndex
CREATE INDEX "Provider_status_providerType_createdAt_idx" ON "Provider"("status", "providerType", "createdAt");

-- CreateIndex
CREATE INDEX "Provider_createdByUserId_status_idx" ON "Provider"("createdByUserId", "status");

-- CreateIndex
CREATE INDEX "ProviderPinCode_pinCode_idx" ON "ProviderPinCode"("pinCode");

-- CreateIndex
CREATE INDEX "ProviderPinCode_providerId_idx" ON "ProviderPinCode"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPinCode_providerId_pinCode_key" ON "ProviderPinCode"("providerId", "pinCode");

-- CreateIndex
CREATE INDEX "ProviderRevision_providerId_createdAt_idx" ON "ProviderRevision"("providerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRevision_providerId_version_key" ON "ProviderRevision"("providerId", "version");

-- CreateIndex
CREATE INDEX "VerificationRecord_providerId_idx" ON "VerificationRecord"("providerId");

-- CreateIndex
CREATE INDEX "VerificationRecord_status_idx" ON "VerificationRecord"("status");

-- CreateIndex
CREATE INDEX "VerificationRecord_nextVerificationDate_idx" ON "VerificationRecord"("nextVerificationDate");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRecord_providerId_item_key" ON "VerificationRecord"("providerId", "item");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_nextAttemptAt_idx" ON "OutboxEvent"("publishedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "OutboxEvent_eventType_idx" ON "OutboxEvent"("eventType");

-- CreateIndex
CREATE INDEX "OutboxEvent_occurredAt_idx" ON "OutboxEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_endpoint_key_key" ON "IdempotencyRecord"("userId", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPinCode" ADD CONSTRAINT "ProviderPinCode_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRevision" ADD CONSTRAINT "ProviderRevision_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRevision" ADD CONSTRAINT "ProviderRevision_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

