-- Normalized provider data model (docs/field-spec.md sections 2-8).
--
-- Common data lives in columns, type-specific data lives in `type_data` and is
-- validated against the field registry in `packages/shared/src/fields`.
-- The flat `providers` table from the first iteration stays in place until the
-- portal is moved onto this model.

CREATE TYPE "ProviderOrganizationStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'SUSPENDED',
  'REJECTED',
  'TERMINATED'
);

CREATE TYPE "DoctorProfileStatus" AS ENUM (
  'invited',
  'doctor_confirmed',
  'under_review',
  'approved',
  'changes_requested',
  'rejected'
);

CREATE TABLE "provider_organizations" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "provider_type" "ProviderType" NOT NULL,
  "status" "ProviderOrganizationStatus" NOT NULL DEFAULT 'DRAFT',
  "legal_name" TEXT,
  "trade_name" TEXT,
  "constitution_type" TEXT,
  "registration_number" TEXT,
  "established_on" DATE,
  "website" TEXT,
  "email" TEXT,
  "mobile" TEXT,
  "primary_pin_code" CHAR(6),
  "primary_district_id" UUID,
  "primary_state_id" UUID,
  "type_data" JSONB NOT NULL DEFAULT '{}',
  "type_data_schema_version" INTEGER NOT NULL DEFAULT 1,
  "profile_data" JSONB NOT NULL DEFAULT '{}',
  "publication_consents" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" UUID NOT NULL,
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "approved_by_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_organizations_primary_pin_code_check"
    CHECK ("primary_pin_code" IS NULL OR "primary_pin_code" ~ '^[0-9]{6}$')
);

CREATE UNIQUE INDEX "provider_organizations_code_key" ON "provider_organizations"("code");
CREATE INDEX "provider_organizations_provider_type_status_idx"
  ON "provider_organizations"("provider_type", "status");
CREATE INDEX "provider_organizations_status_submitted_at_idx"
  ON "provider_organizations"("status", "submitted_at");
CREATE INDEX "provider_organizations_primary_pin_code_idx"
  ON "provider_organizations"("primary_pin_code");
-- Discovery: "who serves this PIN, of this type, in this state".
CREATE INDEX "provider_organizations_primary_pin_code_provider_type_status_idx"
  ON "provider_organizations"("primary_pin_code", "provider_type", "status");
-- "My applications".
CREATE INDEX "provider_organizations_created_by_user_id_status_idx"
  ON "provider_organizations"("created_by_user_id", "status");
CREATE INDEX "provider_organizations_deleted_at_idx" ON "provider_organizations"("deleted_at");
CREATE INDEX "provider_organizations_primary_district_id_idx"
  ON "provider_organizations"("primary_district_id");
CREATE INDEX "provider_organizations_primary_state_id_idx"
  ON "provider_organizations"("primary_state_id");

-- Free-text lookup over the fields administrators search by. pg_trgm is already
-- installed by the foundation migration, so trigram matching keeps substring
-- search fast without a second search column to maintain.
CREATE INDEX "provider_organizations_legal_name_trgm_idx"
  ON "provider_organizations" USING GIN ("legal_name" gin_trgm_ops);
CREATE INDEX "provider_organizations_trade_name_trgm_idx"
  ON "provider_organizations" USING GIN ("trade_name" gin_trgm_ops);
CREATE INDEX "provider_organizations_mobile_trgm_idx"
  ON "provider_organizations" USING GIN ("mobile" gin_trgm_ops);
CREATE INDEX "provider_organizations_registration_number_trgm_idx"
  ON "provider_organizations" USING GIN ("registration_number" gin_trgm_ops);

CREATE TABLE "provider_locations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "location_type" TEXT NOT NULL,
  "address_line1" TEXT NOT NULL,
  "address_line2" TEXT,
  "landmark" TEXT,
  "city" TEXT NOT NULL,
  "district_id" UUID,
  "state_id" UUID,
  "pin_code" CHAR(6) NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "operating_hours" JSONB NOT NULL DEFAULT '{}',
  "booking_phone" TEXT,
  "branch_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_locations_pin_code_check" CHECK ("pin_code" ~ '^[0-9]{6}$')
);

CREATE INDEX "provider_locations_organization_id_idx" ON "provider_locations"("organization_id");
CREATE INDEX "provider_locations_pin_code_idx" ON "provider_locations"("pin_code");
CREATE INDEX "provider_locations_organization_id_is_primary_idx"
  ON "provider_locations"("organization_id", "is_primary");
CREATE INDEX "provider_locations_district_id_idx" ON "provider_locations"("district_id");
CREATE INDEX "provider_locations_state_id_idx" ON "provider_locations"("state_id");

CREATE TABLE "provider_service_pins" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "pin_code" CHAR(6) NOT NULL,
  "service_kind" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_service_pins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_service_pins_pin_code_check" CHECK ("pin_code" ~ '^[0-9]{6}$')
);

CREATE UNIQUE INDEX "provider_service_pins_organization_id_pin_code_service_kind_key"
  ON "provider_service_pins"("organization_id", "pin_code", "service_kind");
CREATE INDEX "provider_service_pins_pin_code_idx" ON "provider_service_pins"("pin_code");
CREATE INDEX "provider_service_pins_organization_id_idx"
  ON "provider_service_pins"("organization_id");

CREATE TABLE "provider_contacts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "designation" TEXT,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_contacts_organization_id_role_key"
  ON "provider_contacts"("organization_id", "role");
CREATE INDEX "provider_contacts_organization_id_idx" ON "provider_contacts"("organization_id");

CREATE TABLE "provider_documents" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" TEXT,
  "uploaded_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_documents_size_bytes_check" CHECK ("size_bytes" > 0)
);

CREATE INDEX "provider_documents_organization_id_idx" ON "provider_documents"("organization_id");

CREATE TABLE "provider_licences" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "location_id" UUID,
  "licence_type_id" UUID,
  "number" TEXT NOT NULL,
  "authority" TEXT,
  "issued_on" DATE,
  "valid_from" DATE,
  "valid_to" DATE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "document_id" UUID,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_licences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_licences_validity_check"
    CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from")
);

CREATE INDEX "provider_licences_organization_id_idx" ON "provider_licences"("organization_id");
CREATE INDEX "provider_licences_licence_type_id_idx" ON "provider_licences"("licence_type_id");
CREATE INDEX "provider_licences_valid_to_idx" ON "provider_licences"("valid_to");

CREATE TABLE "provider_insurance" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "insurer" TEXT NOT NULL,
  "policy_no" TEXT NOT NULL,
  "limit_paise" INTEGER,
  "valid_from" DATE,
  "valid_to" DATE,
  "document_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "provider_insurance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_insurance_limit_paise_check"
    CHECK ("limit_paise" IS NULL OR "limit_paise" >= 0),
  CONSTRAINT "provider_insurance_validity_check"
    CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from")
);

CREATE INDEX "provider_insurance_organization_id_idx" ON "provider_insurance"("organization_id");
CREATE INDEX "provider_insurance_valid_to_idx" ON "provider_insurance"("valid_to");

CREATE TABLE "doctor_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID,
  "full_name" TEXT NOT NULL,
  "registration_no" TEXT NOT NULL,
  "council_id" UUID,
  "system_of_medicine" TEXT NOT NULL,
  "specialty_id" UUID,
  "qualifications" JSONB NOT NULL DEFAULT '[]',
  "photo_document_id" UUID,
  "status" "DoctorProfileStatus" NOT NULL DEFAULT 'invited',
  "created_by_org_id" UUID,
  "doctor_confirmed_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("id"),
  -- A profile is either owned by a doctor organization, or clinic-created and
  -- not yet confirmed. Nothing else is allowed.
  CONSTRAINT "doctor_profiles_organization_rule_check"
    CHECK (
      "organization_id" IS NOT NULL
      OR ("created_by_org_id" IS NOT NULL AND "doctor_confirmed_at" IS NULL)
    )
);

CREATE INDEX "doctor_profiles_registration_no_council_id_idx"
  ON "doctor_profiles"("registration_no", "council_id");
-- Same registration number and council is the same doctor, but soft-deleted
-- rows must not block a later re-registration.
CREATE UNIQUE INDEX "doctor_profiles_registration_no_council_id_live_key"
  ON "doctor_profiles"("registration_no", "council_id")
  WHERE "deleted_at" IS NULL;
CREATE INDEX "doctor_profiles_organization_id_idx" ON "doctor_profiles"("organization_id");
CREATE INDEX "doctor_profiles_created_by_org_id_idx" ON "doctor_profiles"("created_by_org_id");
CREATE INDEX "doctor_profiles_deleted_at_idx" ON "doctor_profiles"("deleted_at");

CREATE TABLE "doctor_locations" (
  "id" UUID NOT NULL,
  "doctor_profile_id" UUID NOT NULL,
  "location_id" UUID,
  "clinic_organization_id" UUID,
  "role_at_clinic" TEXT,
  "timings" JSONB NOT NULL DEFAULT '{}',
  "fee_paise" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "doctor_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doctor_locations_target_check"
    CHECK ("location_id" IS NOT NULL OR "clinic_organization_id" IS NOT NULL),
  CONSTRAINT "doctor_locations_fee_paise_check" CHECK ("fee_paise" IS NULL OR "fee_paise" >= 0)
);

CREATE INDEX "doctor_locations_doctor_profile_id_idx" ON "doctor_locations"("doctor_profile_id");
CREATE INDEX "doctor_locations_location_id_idx" ON "doctor_locations"("location_id");
CREATE INDEX "doctor_locations_clinic_organization_id_idx"
  ON "doctor_locations"("clinic_organization_id");

CREATE TABLE "provider_status_history" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "from_status" "ProviderOrganizationStatus",
  "to_status" "ProviderOrganizationStatus" NOT NULL,
  "changed_by_user_id" UUID NOT NULL,
  "reason" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_status_history_organization_id_at_idx"
  ON "provider_status_history"("organization_id", "at");

-- Read model: counts per PIN, provider type and status. Populated from locations
-- and service pins; never written by the portal directly.
CREATE TABLE "provider_pin_stats" (
  "pin_code" CHAR(6) NOT NULL,
  "provider_type" "ProviderType" NOT NULL,
  "status" "ProviderOrganizationStatus" NOT NULL,
  "count" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_pin_stats_pkey" PRIMARY KEY ("pin_code", "provider_type", "status"),
  CONSTRAINT "provider_pin_stats_pin_code_check" CHECK ("pin_code" ~ '^[0-9]{6}$'),
  CONSTRAINT "provider_pin_stats_count_check" CHECK ("count" >= 0)
);

CREATE INDEX "provider_pin_stats_provider_type_status_idx"
  ON "provider_pin_stats"("provider_type", "status");

-- Foreign keys -----------------------------------------------------------------
ALTER TABLE "provider_organizations"
  ADD CONSTRAINT "provider_organizations_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_organizations_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_organizations_primary_district_id_fkey"
    FOREIGN KEY ("primary_district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_organizations_primary_state_id_fkey"
    FOREIGN KEY ("primary_state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_locations"
  ADD CONSTRAINT "provider_locations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_locations_district_id_fkey"
    FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_locations_state_id_fkey"
    FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_service_pins"
  ADD CONSTRAINT "provider_service_pins_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_contacts"
  ADD CONSTRAINT "provider_contacts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_documents"
  ADD CONSTRAINT "provider_documents_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_documents_uploaded_by_user_id_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_licences"
  ADD CONSTRAINT "provider_licences_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_licences_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "provider_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_licences_licence_type_id_fkey"
    FOREIGN KEY ("licence_type_id") REFERENCES "licence_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_licences_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_insurance"
  ADD CONSTRAINT "provider_insurance_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_insurance_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "doctor_profiles"
  ADD CONSTRAINT "doctor_profiles_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_profiles_created_by_org_id_fkey"
    FOREIGN KEY ("created_by_org_id") REFERENCES "provider_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_profiles_council_id_fkey"
    FOREIGN KEY ("council_id") REFERENCES "councils"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_profiles_specialty_id_fkey"
    FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_profiles_photo_document_id_fkey"
    FOREIGN KEY ("photo_document_id") REFERENCES "provider_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "doctor_locations"
  ADD CONSTRAINT "doctor_locations_doctor_profile_id_fkey"
    FOREIGN KEY ("doctor_profile_id") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_locations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "provider_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "doctor_locations_clinic_organization_id_fkey"
    FOREIGN KEY ("clinic_organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_status_history"
  ADD CONSTRAINT "provider_status_history_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "provider_status_history_changed_by_user_id_fkey"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provider codes ---------------------------------------------------------------
-- One sequence per provider type so codes are dense within a type and never
-- reused. `next_provider_code` is the only place that knows the prefix.
CREATE SEQUENCE "provider_code_seq_doctor" AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "provider_code_seq_clinic" AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "provider_code_seq_pharmacy" AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "provider_code_seq_diagnostic" AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE "provider_code_seq_care" AS BIGINT START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION next_provider_code(p_type "ProviderType") RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  prefix TEXT;
  sequence_value BIGINT;
BEGIN
  CASE p_type
    WHEN 'doctor' THEN
      prefix := 'DOC';
      sequence_value := nextval('provider_code_seq_doctor');
    WHEN 'clinic' THEN
      prefix := 'CL';
      sequence_value := nextval('provider_code_seq_clinic');
    WHEN 'pharmacy' THEN
      prefix := 'PH';
      sequence_value := nextval('provider_code_seq_pharmacy');
    WHEN 'diagnostic_centre' THEN
      prefix := 'DC';
      sequence_value := nextval('provider_code_seq_diagnostic');
    WHEN 'care_provider' THEN
      prefix := 'CP';
      sequence_value := nextval('provider_code_seq_care');
    ELSE
      RAISE EXCEPTION 'Unsupported provider type: %', p_type;
  END CASE;

  RETURN 'CN-' || prefix || '-' || lpad(sequence_value::TEXT, 6, '0');
END;
$$;

COMMENT ON FUNCTION next_provider_code("ProviderType") IS
  'Human-readable provider code (CN-PH-000123) from the per-type sequence.';
