-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('publication', 'data_privacy_notice', 'declarations', 'doctor_confirmation', 'agreement');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('SIGNED_FORM_UPLOAD', 'OTP', 'LINK_CONFIRMATION', 'IN_PERSON_ATTESTATION');

-- CreateEnum
CREATE TYPE "AgreementTemplateStatus" AS ENUM ('draft', 'active', 'retired');

-- DropIndex
DROP INDEX "Provider_city_trgm_idx";

-- DropIndex
DROP INDEX "Provider_displayName_trgm_idx";

-- DropIndex
DROP INDEX "Provider_legalName_trgm_idx";

-- DropIndex
DROP INDEX "provider_licences_org_valid_to_idx";

-- DropIndex
DROP INDEX "provider_org_directory_code_trgm_idx";

-- DropIndex
DROP INDEX "provider_org_directory_legal_name_trgm_idx";

-- DropIndex
DROP INDEX "provider_org_directory_mobile_trgm_idx";

-- DropIndex
DROP INDEX "provider_org_directory_registration_trgm_idx";

-- DropIndex
DROP INDEX "provider_org_directory_trade_name_trgm_idx";

-- DropIndex
DROP INDEX "provider_organizations_legal_name_trgm_idx";

-- DropIndex
DROP INDEX "provider_organizations_mobile_trgm_idx";

-- DropIndex
DROP INDEX "provider_organizations_registration_number_trgm_idx";

-- DropIndex
DROP INDEX "provider_organizations_trade_name_trgm_idx";

-- AlterTable
ALTER TABLE "councils" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "districts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_types" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "verified_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "facility_types" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "licence_types" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pin_codes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "provider_directory_views" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "provider_duplicate_dismissals" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "provider_pin_stats" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "service_categories" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "specialties" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "states" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "doctor_profile_id" UUID,
    "consent_type" "ConsentType" NOT NULL,
    "text_version" TEXT NOT NULL,
    "captured_by_user_id" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "ConsentMethod" NOT NULL,
    "evidence_document_id" UUID,
    "confirmation_meta" JSONB NOT NULL DEFAULT '{}',
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" UUID,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_templates" (
    "id" UUID NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "file_document_id" UUID,
    "status" "AgreementTemplateStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_acceptances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "signed_on" DATE NOT NULL,
    "place" TEXT NOT NULL,
    "signatory_name" TEXT NOT NULL,
    "signatory_designation" TEXT NOT NULL,
    "signed_document_id" UUID,
    "stamp_reference" TEXT,
    "witnesses" JSONB NOT NULL DEFAULT '[]',
    "recorded_by_user_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confirmation_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "doctor_profile_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "confirmation_meta" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_organization_id_consent_type_idx" ON "consent_records"("organization_id", "consent_type");

-- CreateIndex
CREATE INDEX "consent_records_doctor_profile_id_idx" ON "consent_records"("doctor_profile_id");

-- CreateIndex
CREATE INDEX "consent_records_revoked_at_idx" ON "consent_records"("revoked_at");

-- CreateIndex
CREATE INDEX "agreement_templates_provider_type_status_idx" ON "agreement_templates"("provider_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_templates_provider_type_version_key" ON "agreement_templates"("provider_type", "version");

-- CreateIndex
CREATE INDEX "agreement_acceptances_organization_id_idx" ON "agreement_acceptances"("organization_id");

-- CreateIndex
CREATE INDEX "agreement_acceptances_template_id_idx" ON "agreement_acceptances"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "confirmation_requests_token_hash_key" ON "confirmation_requests"("token_hash");

-- CreateIndex
CREATE INDEX "confirmation_requests_organization_id_idx" ON "confirmation_requests"("organization_id");

-- CreateIndex
CREATE INDEX "confirmation_requests_expires_at_idx" ON "confirmation_requests"("expires_at");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_doctor_profile_id_fkey" FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_captured_by_user_id_fkey" FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "agreement_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_signed_document_id_fkey" FOREIGN KEY ("signed_document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_requests" ADD CONSTRAINT "confirmation_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
