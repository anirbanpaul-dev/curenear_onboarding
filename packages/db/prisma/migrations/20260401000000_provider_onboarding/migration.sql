-- Provider onboarding API support.
--
-- 1. `provider_documents.role` lets a document fulfil a specific registry
--    requirement (profile logo, medical registration, PCPNDT certificate, ...),
--    which is what the completeness report and the submit gate check.
-- 2. `provider_duplicate_dismissals` records an administrator's "not a
--    duplicate" decision for a pair of providers, so the warning is not raised
--    again.

ALTER TABLE "provider_documents" ADD COLUMN "role" TEXT;

CREATE TABLE "provider_duplicate_dismissals" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "duplicate_organization_id" UUID NOT NULL,
  "dismissed_by_user_id" UUID NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_duplicate_dismissals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_duplicate_dismissals_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_duplicate_dismissals_duplicate_organization_id_fkey"
    FOREIGN KEY ("duplicate_organization_id") REFERENCES "provider_organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_duplicate_dismissals_dismissed_by_user_id_fkey"
    FOREIGN KEY ("dismissed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_duplicate_dismissals_not_self" CHECK ("organization_id" <> "duplicate_organization_id")
);

CREATE UNIQUE INDEX "provider_duplicate_dismissals_organization_id_duplicate_organization_id_key"
  ON "provider_duplicate_dismissals"("organization_id", "duplicate_organization_id");
CREATE INDEX "provider_duplicate_dismissals_duplicate_organization_id_idx"
  ON "provider_duplicate_dismissals"("duplicate_organization_id");
