-- Event-driven system: outbox dead letters, notifications, handler idempotency,
-- job history, webhook deliveries and the provider search read model.

-- ============================================================ outbox dead letter
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" TIMESTAMP(3);
CREATE INDEX "outbox_events_dead_lettered_at_idx" ON "outbox_events"("dead_lettered_at");

-- ============================================================ notifications
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "event_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- One row per user per event: replaying an event cannot duplicate a bell entry.
CREATE UNIQUE INDEX "notifications_user_id_type_event_id_key"
    ON "notifications"("user_id", "type", "event_id");
CREATE INDEX "notifications_user_id_read_at_created_at_idx"
    ON "notifications"("user_id", "read_at", "created_at");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "type")
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================ handler idempotency
CREATE TABLE "processed_event_handlers" (
    "event_id" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_handlers_pkey" PRIMARY KEY ("event_id", "handler")
);

CREATE INDEX "processed_event_handlers_processed_at_idx"
    ON "processed_event_handlers"("processed_at");

-- ============================================================ job history
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_runs_queue_started_at_idx" ON "job_runs"("queue", "started_at");
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- ============================================================ webhooks
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "event_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_endpoints_url_key" ON "webhook_endpoints"("url");

CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_key"
    ON "webhook_deliveries"("endpoint_id", "event_id");
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx"
    ON "webhook_deliveries"("status", "next_attempt_at");

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey"
    FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================ provider search index
CREATE TABLE "provider_search_index" (
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "provider_type" "ProviderType" NOT NULL,
    "status" "ProviderOrganizationStatus" NOT NULL,
    "primary_pin_code" CHAR(6),
    "legal_name" TEXT,
    "city" TEXT,
    "doctor_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_search_index_pkey" PRIMARY KEY ("organization_id")
);

CREATE INDEX "provider_search_index_primary_pin_code_status_idx"
    ON "provider_search_index"("primary_pin_code", "status");
CREATE INDEX "provider_search_index_provider_type_status_idx"
    ON "provider_search_index"("provider_type", "status");

ALTER TABLE "provider_search_index" ADD CONSTRAINT "provider_search_index_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================ compliance flag
ALTER TABLE "provider_organizations" ADD COLUMN "compliance_flag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "provider_organizations" ADD COLUMN "compliance_flag_reason" TEXT;
