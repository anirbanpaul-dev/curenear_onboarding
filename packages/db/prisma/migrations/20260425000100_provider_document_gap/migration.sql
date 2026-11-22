-- Denormalised "required documents are missing" flag for the admin directory.
--
-- Computing this per row at query time means one document anti-join per
-- provider, which costs ~200 ms at 100,000 providers and cannot use an index.
-- Instead the flag is kept current by triggers on the three tables it depends
-- on (provider_organizations, provider_documents, provider_licences), so any
-- writer — service, script or migration — keeps it accurate.
--
-- `provider_required_documents` mirrors the field registry's always-required
-- document set. Conditional documents are deliberately excluded (their
-- requirement depends on other answers and is a completeness rule, not a
-- directory filter). When the registry's required document set changes, add a
-- migration that replaces this function and re-runs the backfill below.

ALTER TABLE "provider_organizations"
  ADD COLUMN "document_gap" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "provider_org_directory_document_gap_idx"
  ON "provider_organizations" ("document_gap", "created_at" DESC, "id")
  WHERE "deleted_at" IS NULL;

CREATE OR REPLACE FUNCTION provider_required_documents(p_type "ProviderType")
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_type
    WHEN 'doctor' THEN
      '{"documents": ["doc_reg_doc"], "licences": []}'::jsonb
    WHEN 'clinic' THEN
      '{"documents": [], "licences": []}'::jsonb
    WHEN 'pharmacy' THEN
      '{"documents": [], "licences": ["drug_licence"]}'::jsonb
    WHEN 'diagnostic_centre' THEN
      '{"documents": ["dc_bmw_doc"], "licences": ["clinical_establishment"]}'::jsonb
    WHEN 'care_provider' THEN
      '{"documents": ["cp_bg_policy_doc", "cp_safeguarding_doc", "cp_incident_protocol_doc"],
        "licences": ["care_registration"]}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION provider_document_gap(p_id UUID, p_type "ProviderType")
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(provider_required_documents(p_type) -> 'documents') AS req(role)
      WHERE NOT EXISTS (
        SELECT 1 FROM provider_documents d
        WHERE d.organization_id = p_id AND d.role = req.role AND d.deleted_at IS NULL
      )
    )
    OR (
      jsonb_array_length(provider_required_documents(p_type) -> 'licences') > 0
      AND (
        NOT EXISTS (SELECT 1 FROM provider_licences l WHERE l.organization_id = p_id)
        OR EXISTS (
          SELECT 1 FROM provider_licences l
          WHERE l.organization_id = p_id AND l.document_id IS NULL
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION provider_organizations_set_document_gap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."document_gap" := provider_document_gap(NEW."id", NEW."provider_type");
  RETURN NEW;
END;
$$;

-- Only an insert or a type change needs the row's own value recomputed; the
-- child triggers below write `document_gap` directly and must not recurse.
CREATE TRIGGER "provider_organizations_document_gap"
BEFORE INSERT OR UPDATE OF "provider_type" ON "provider_organizations"
FOR EACH ROW EXECUTE FUNCTION provider_organizations_set_document_gap();

CREATE OR REPLACE FUNCTION provider_children_refresh_document_gap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target UUID;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD."organization_id" ELSE NEW."organization_id" END;

  UPDATE "provider_organizations" o
  SET "document_gap" = provider_document_gap(o."id", o."provider_type")
  WHERE o."id" = target;

  IF TG_OP = 'UPDATE' AND NEW."organization_id" <> OLD."organization_id" THEN
    UPDATE "provider_organizations" o
    SET "document_gap" = provider_document_gap(o."id", o."provider_type")
    WHERE o."id" = OLD."organization_id";
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "provider_documents_document_gap"
AFTER INSERT OR UPDATE OR DELETE ON "provider_documents"
FOR EACH ROW EXECUTE FUNCTION provider_children_refresh_document_gap();

CREATE TRIGGER "provider_licences_document_gap"
AFTER INSERT OR UPDATE OR DELETE ON "provider_licences"
FOR EACH ROW EXECUTE FUNCTION provider_children_refresh_document_gap();

-- Backfill existing rows. On a very large table run this migration during a
-- quiet window; it touches every provider once.
UPDATE "provider_organizations" o
SET "document_gap" = provider_document_gap(o."id", o."provider_type");
