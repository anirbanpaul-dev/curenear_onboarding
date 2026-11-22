-- The PIN read model now separates the three measures: primary location,
-- doctors practising (practice locations), and service coverage.
CREATE TYPE "PinStatMeasure" AS ENUM ('primary', 'doctor_practice', 'service');

DROP INDEX "provider_pin_stats_provider_type_status_idx";

ALTER TABLE "provider_pin_stats" DROP CONSTRAINT "provider_pin_stats_pkey",
ADD COLUMN     "measure" "PinStatMeasure" NOT NULL DEFAULT 'primary',
ADD CONSTRAINT "provider_pin_stats_pkey" PRIMARY KEY ("pin_code", "provider_type", "status", "measure");

-- Remembers what each organisation contributes, so incremental updates can
-- subtract exactly what was added before (PIN moves, deletes).
CREATE TABLE "provider_pin_contributions" (
    "measure" "PinStatMeasure" NOT NULL,
    "subject_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pin_code" CHAR(6) NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "status" "ProviderOrganizationStatus" NOT NULL,

    CONSTRAINT "provider_pin_contributions_pkey" PRIMARY KEY ("measure","subject_id","pin_code")
);

CREATE INDEX "provider_pin_contributions_organization_id_idx" ON "provider_pin_contributions"("organization_id");

CREATE INDEX "provider_pin_stats_measure_provider_type_status_idx" ON "provider_pin_stats"("measure", "provider_type", "status");

ALTER TABLE "provider_pin_contributions" ADD CONSTRAINT "provider_pin_contributions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
