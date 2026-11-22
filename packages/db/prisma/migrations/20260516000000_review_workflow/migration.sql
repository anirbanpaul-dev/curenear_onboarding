-- Admin review workflow (field spec section 10).
-- The legacy flat-provider verification table keeps its data under a new name;
-- `verification_records` now holds organization/doctor checklist items.

ALTER TABLE "VerificationRecord" RENAME TO "legacy_verification_records";

CREATE TYPE "ReviewVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'NOT_APPLICABLE');
CREATE TYPE "SuspensionScope" AS ENUM ('WHOLE_PROFILE', 'LOCATION', 'SERVICE_CATEGORY');

CREATE TABLE "verification_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "doctor_profile_id" UUID,
    "item" TEXT NOT NULL,
    "section_key" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ReviewVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "source" TEXT,
    "evidence_ref" TEXT,
    "reason" TEXT,
    "next_verification_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "verification_records_owner_check" CHECK (
      (("organization_id" IS NOT NULL)::int + ("doctor_profile_id" IS NOT NULL)::int) = 1
    )
);

CREATE UNIQUE INDEX "verification_records_organization_id_item_key" ON "verification_records"("organization_id", "item");
CREATE UNIQUE INDEX "verification_records_doctor_profile_id_item_key" ON "verification_records"("doctor_profile_id", "item");
CREATE INDEX "verification_records_organization_id_status_idx" ON "verification_records"("organization_id", "status");

ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "review_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_comments_organization_id_created_at_idx" ON "review_comments"("organization_id", "created_at");
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "review_assignments" (
    "organization_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "review_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "sla_warn_hours" INTEGER NOT NULL DEFAULT 48,
    "sla_breach_hours" INTEGER NOT NULL DEFAULT 72,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "provider_status_history"
  ADD COLUMN "scope" "SuspensionScope",
  ADD COLUMN "scope_ref_id" UUID,
  ADD COLUMN "scope_label" TEXT,
  ADD COLUMN "flagged_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
