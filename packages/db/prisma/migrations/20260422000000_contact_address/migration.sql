-- Section 3.5a stores the legal-notice address on the legal_notice contact row.
-- Other contact roles leave it null.

ALTER TABLE "provider_contacts" ADD COLUMN "address" JSONB;
