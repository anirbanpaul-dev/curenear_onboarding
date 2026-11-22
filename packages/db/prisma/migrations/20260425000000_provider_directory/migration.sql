-- Admin provider directory: saved filter presets and the indexes its filters and
-- sorts rely on.
--
-- Every filter in /api/v1/admin/providers maps to one of these indexes. The
-- directory only ever reads live rows, so the composites are partial
-- (`WHERE deleted_at IS NULL`), which keeps them small and lets PostgreSQL skip
-- soft-deleted providers entirely. `id` is appended to sorted indexes so the
-- ORDER BY has a deterministic tiebreaker and page boundaries stay stable.

CREATE TABLE "provider_directory_views" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_directory_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_directory_views_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_directory_views_name_check" CHECK (length("name") BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "provider_directory_views_user_id_name_key"
  ON "provider_directory_views"("user_id", "name");
CREATE INDEX "provider_directory_views_user_id_idx"
  ON "provider_directory_views"("user_id");

-- Default sort (`created_at DESC, id`).
CREATE INDEX "provider_org_directory_created_idx"
  ON "provider_organizations" ("created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_updated_idx"
  ON "provider_organizations" ("updated_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_name_idx"
  ON "provider_organizations" ("legal_name", "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_submitted_idx"
  ON "provider_organizations" ("submitted_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

-- provider_type / status filters combined with the default sort.
CREATE INDEX "provider_org_directory_type_created_idx"
  ON "provider_organizations" ("provider_type", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_status_created_idx"
  ON "provider_organizations" ("status", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

-- onboarded_by + newest first, and the staff detail page's provider list.
CREATE INDEX "provider_org_directory_creator_created_idx"
  ON "provider_organizations" ("created_by_user_id", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_state_created_idx"
  ON "provider_organizations" ("primary_state_id", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "provider_org_directory_district_created_idx"
  ON "provider_organizations" ("primary_district_id", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

-- PIN prefix filter: `primary_pin_code` is char(6), and a `LIKE '7000%'` on a
-- bpchar column needs an expression index with text_pattern_ops to stay indexed.
CREATE INDEX "provider_org_directory_pin_prefix_idx"
  ON "provider_organizations" (("primary_pin_code"::text) text_pattern_ops)
  WHERE "deleted_at" IS NULL;

-- Text search (name, trade name, mobile, registration number, provider code).
CREATE INDEX "provider_org_directory_legal_name_trgm_idx"
  ON "provider_organizations" USING GIN ("legal_name" gin_trgm_ops);
CREATE INDEX "provider_org_directory_trade_name_trgm_idx"
  ON "provider_organizations" USING GIN ("trade_name" gin_trgm_ops);
CREATE INDEX "provider_org_directory_mobile_trgm_idx"
  ON "provider_organizations" USING GIN ("mobile" gin_trgm_ops);
CREATE INDEX "provider_org_directory_registration_trgm_idx"
  ON "provider_organizations" USING GIN ("registration_number" gin_trgm_ops);
CREATE INDEX "provider_org_directory_code_trgm_idx"
  ON "provider_organizations" USING GIN ("code" gin_trgm_ops);

-- "licence expiring within N days": a semi-join on the licence's own index.
CREATE INDEX "provider_licences_org_valid_to_idx"
  ON "provider_licences" ("organization_id", "valid_to");

-- "has missing documents": the anti-join checks one role per required document.
CREATE INDEX "provider_documents_org_role_idx"
  ON "provider_documents" ("organization_id", "role")
  WHERE "deleted_at" IS NULL;
