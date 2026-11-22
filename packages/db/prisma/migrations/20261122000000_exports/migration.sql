-- Asynchronous CSV exports.
--
-- `export_files` is private-storage metadata only; the bytes never live in
-- PostgreSQL and are never proxied through the web app. `export_jobs` is both
-- the queue (status + started_at) and the history shown on /exports.

CREATE TYPE "ExportType" AS ENUM ('providers', 'pin_summary', 'staff_performance', 'expiring_documents');
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

CREATE TABLE "export_files" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_files_storage_key_key" ON "export_files"("storage_key");

CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "type" "ExportType" NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_user_id" UUID NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "row_count" INTEGER,
    "file_document_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_jobs_requested_by_user_id_status_idx"
    ON "export_jobs"("requested_by_user_id", "status");
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

ALTER TABLE "export_jobs"
    ADD CONSTRAINT "export_jobs_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
    ADD CONSTRAINT "export_jobs_file_document_id_fkey"
    FOREIGN KEY ("file_document_id") REFERENCES "export_files"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
