-- The reusable document service.
--
-- Files live in object storage; this table holds metadata only. `owner_id` is
-- intentionally not a foreign key: the same table serves the portal provider
-- model and the normalized provider_organization model, and the service checks
-- ownership before every read or presign.
--
-- `expires_on` is indexed for the expiry reminder job (Prompt 17), and
-- `status` + `expires_on` supports "expiring soon" scans without a full scan.

CREATE TYPE "DocumentOwnerType" AS ENUM ('provider', 'provider_organization');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_SCAN', 'UPLOADED', 'VERIFIED', 'REJECTED', 'EXPIRED');

CREATE TABLE "documents" (
  "id" UUID NOT NULL,
  "owner_type" "DocumentOwnerType" NOT NULL,
  "owner_id" UUID NOT NULL,
  "document_type_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "checksum_sha256" CHAR(64),
  "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "expires_on" DATE,
  "uploaded_by" UUID NOT NULL,
  "verified_by" UUID,
  "verified_at" TIMESTAMPTZ(3),
  "rejection_reason" TEXT,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_size_bytes_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "documents_document_type_id_fkey"
    FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "documents_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "documents_verified_by_fkey"
    FOREIGN KEY ("verified_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");
CREATE INDEX "documents_owner_type_owner_id_idx" ON "documents"("owner_type", "owner_id");
CREATE INDEX "documents_document_type_id_idx" ON "documents"("document_type_id");
CREATE INDEX "documents_expires_on_idx" ON "documents"("expires_on");
CREATE INDEX "documents_status_expires_on_idx" ON "documents"("status", "expires_on");
