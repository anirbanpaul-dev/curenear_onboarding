-- Master data the whole portal depends on. Every list here is editable data, not
-- an enum, so administrators can extend it without a deploy.

CREATE TYPE "CouncilKind" AS ENUM ('medical', 'pharmacy', 'nursing', 'other');

CREATE TABLE "states" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "states_code_key" ON "states"("code");
CREATE UNIQUE INDEX "states_name_key" ON "states"("name");

CREATE TABLE "districts" (
  "id" UUID NOT NULL,
  "state_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "districts_state_id_name_key" ON "districts"("state_id", "name");
CREATE INDEX "districts_name_idx" ON "districts"("name");

CREATE TABLE "pin_codes" (
  "pin_code" CHAR(6) NOT NULL,
  "office_name" TEXT NOT NULL,
  "district_id" UUID,
  "state_id" UUID,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pin_codes_pkey" PRIMARY KEY ("pin_code")
);

CREATE INDEX "pin_codes_office_name_idx" ON "pin_codes"("office_name");
CREATE INDEX "pin_codes_state_id_idx" ON "pin_codes"("state_id");
CREATE INDEX "pin_codes_district_id_idx" ON "pin_codes"("district_id");

CREATE TABLE "specialties" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "system_of_medicine" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "specialties_code_key" ON "specialties"("code");
CREATE INDEX "specialties_system_of_medicine_idx" ON "specialties"("system_of_medicine");

CREATE TABLE "licence_types" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "applicable_provider_types" "ProviderType"[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "licence_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "licence_types_code_key" ON "licence_types"("code");

CREATE TABLE "councils" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "CouncilKind" NOT NULL,
  "state_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "councils_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "councils_code_key" ON "councils"("code");
CREATE INDEX "councils_kind_idx" ON "councils"("kind");
CREATE INDEX "councils_state_id_idx" ON "councils"("state_id");

CREATE TABLE "service_categories" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider_type" "ProviderType" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_code_key" ON "service_categories"("code");
CREATE INDEX "service_categories_provider_type_idx" ON "service_categories"("provider_type");

CREATE TABLE "facility_types" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "facility_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facility_types_code_key" ON "facility_types"("code");

CREATE TABLE "document_types" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider_types" "ProviderType"[],
  "requires_expiry" BOOLEAN NOT NULL DEFAULT false,
  "expiry_reminder_days" INTEGER[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

ALTER TABLE "districts"
  ADD CONSTRAINT "districts_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pin_codes"
  ADD CONSTRAINT "pin_codes_district_id_fkey"
  FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pin_codes"
  ADD CONSTRAINT "pin_codes_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "councils"
  ADD CONSTRAINT "councils_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;
