-- Foundation schema. Adds the auth/session/audit/outbox/settings layer the portal needs
-- and gives those tables snake_case names (Prisma keeps camelCase field names via @map).
-- Provider tables keep their current names until the provider phase; this migration
-- renames the existing foundation tables in place so no data is lost.
--
-- Ids stay uuid v4: PostgreSQL 16 (docker compose, CI) has no uuidv7(), and Prisma's
-- `uuid()` is the documented v4 generator.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================ users
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

ALTER TABLE "User" RENAME TO "users";

ALTER TABLE "users" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "users" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";

-- isActive becomes an explicit three-state status.
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "users"
SET "status" = CASE
  WHEN "isActive" THEN 'ACTIVE'::"UserStatus"
  ELSE 'INACTIVE'::"UserStatus"
END;
ALTER TABLE "users" DROP COLUMN "isActive";

ALTER TABLE "users" ADD COLUMN "mobile" TEXT;
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "employee_code" TEXT;
ALTER TABLE "users" ADD COLUMN "created_by_user_id" UUID;

-- Emails are stored lowercased; enforce it rather than trusting every caller.
UPDATE "users" SET "email" = lower("email");
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER INDEX "User_email_key" RENAME TO "users_email_key";

ALTER INDEX "User_role_idx" RENAME TO "users_role_idx";
ALTER INDEX "User_deletedAt_idx" RENAME TO "users_deleted_at_idx";
ALTER INDEX "User_createdAt_idx" RENAME TO "users_created_at_idx";

CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE INDEX "users_created_by_user_id_idx" ON "users"("created_by_user_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================ sessions
ALTER TABLE "Session" RENAME TO "sessions";

ALTER TABLE "sessions" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "sessions" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "sessions" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "sessions" RENAME COLUMN "createdAt" TO "created_at";

ALTER TABLE "sessions" ADD COLUMN "last_seen_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN "ip" TEXT;
ALTER TABLE "sessions" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "sessions" ADD COLUMN "revoked_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "sessions" RENAME CONSTRAINT "Session_pkey" TO "sessions_pkey";
ALTER INDEX "Session_tokenHash_key" RENAME TO "sessions_token_hash_key";
ALTER TABLE "sessions" RENAME CONSTRAINT "Session_userId_fkey" TO "sessions_user_id_fkey";

ALTER INDEX "Session_userId_idx" RENAME TO "sessions_user_id_idx";
ALTER INDEX "Session_expiresAt_idx" RENAME TO "sessions_expires_at_idx";

CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- ============================================================ password_reset_tokens
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_expires_at_idx" ON "password_reset_tokens"("user_id", "expires_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================ audit_logs
ALTER TABLE "AuditLog" RENAME TO "audit_logs";

ALTER TABLE "audit_logs" RENAME COLUMN "actorUserId" TO "actor_user_id";
ALTER TABLE "audit_logs" RENAME COLUMN "actorRole" TO "actor_role";
ALTER TABLE "audit_logs" RENAME COLUMN "entityType" TO "entity_type";
ALTER TABLE "audit_logs" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "audit_logs" RENAME COLUMN "requestId" TO "request_id";
ALTER TABLE "audit_logs" RENAME COLUMN "changedFieldKeys" TO "changed_field_keys";
ALTER TABLE "audit_logs" RENAME COLUMN "fromStatus" TO "from_status";
ALTER TABLE "audit_logs" RENAME COLUMN "toStatus" TO "to_status";
ALTER TABLE "audit_logs" RENAME COLUMN "ipAddress" TO "ip";
ALTER TABLE "audit_logs" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "audit_logs" RENAME COLUMN "createdAt" TO "created_at";

ALTER TABLE "audit_logs" ADD COLUMN "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "audit_logs" SET "occurred_at" = "created_at";
ALTER TABLE "audit_logs" ADD COLUMN "before" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN "after" JSONB;
ALTER TABLE "audit_logs" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "audit_logs" RENAME CONSTRAINT "AuditLog_pkey" TO "audit_logs_pkey";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "AuditLog_actorUserId_fkey" TO "audit_logs_actor_user_id_fkey";

ALTER INDEX "AuditLog_entityType_entityId_createdAt_idx" RENAME TO "audit_logs_entity_type_entity_id_created_at_idx";
ALTER INDEX "AuditLog_actorUserId_idx" RENAME TO "audit_logs_actor_user_id_idx";
ALTER INDEX "AuditLog_action_idx" RENAME TO "audit_logs_action_idx";
ALTER INDEX "AuditLog_createdAt_idx" RENAME TO "audit_logs_created_at_idx";

CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at");
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs"("action", "occurred_at");

-- Append-only audit trail. INSERT is allowed; UPDATE and DELETE are not. TRUNCATE is
-- still available to an owner for local resets (it does not fire row triggers).
CREATE FUNCTION audit_logs_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          HINT = 'Insert a correcting audit entry instead of changing history.';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

-- ============================================================ outbox_events
ALTER TABLE "OutboxEvent" RENAME TO "outbox_events";

ALTER TABLE "outbox_events" RENAME COLUMN "eventType" TO "event_type";
ALTER TABLE "outbox_events" RENAME COLUMN "eventVersion" TO "event_version";
ALTER TABLE "outbox_events" RENAME COLUMN "aggregateType" TO "aggregate_type";
ALTER TABLE "outbox_events" RENAME COLUMN "aggregateId" TO "aggregate_id";
ALTER TABLE "outbox_events" RENAME COLUMN "dedupeKey" TO "dedupe_key";
ALTER TABLE "outbox_events" RENAME COLUMN "occurredAt" TO "occurred_at";
ALTER TABLE "outbox_events" RENAME COLUMN "publishedAt" TO "published_at";
ALTER TABLE "outbox_events" RENAME COLUMN "nextAttemptAt" TO "next_attempt_at";
ALTER TABLE "outbox_events" RENAME COLUMN "lastError" TO "last_error";

ALTER TABLE "outbox_events" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "outbox_events" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "outbox_events" RENAME CONSTRAINT "OutboxEvent_pkey" TO "outbox_events_pkey";
ALTER INDEX "OutboxEvent_dedupeKey_key" RENAME TO "outbox_events_dedupe_key_key";

ALTER INDEX "OutboxEvent_publishedAt_nextAttemptAt_idx" RENAME TO "outbox_events_published_at_next_attempt_at_idx";
ALTER INDEX "OutboxEvent_aggregateType_aggregateId_idx" RENAME TO "outbox_events_aggregate_type_aggregate_id_idx";
ALTER INDEX "OutboxEvent_eventType_idx" RENAME TO "outbox_events_event_type_idx";
ALTER INDEX "OutboxEvent_occurredAt_idx" RENAME TO "outbox_events_occurred_at_idx";

-- The dispatcher only ever scans unpublished rows.
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events"("published_at") WHERE "published_at" IS NULL;

-- ============================================================ idempotency_keys
-- Replaces IdempotencyRecord: replay records are ephemeral, and the new table keys on
-- (scope, key) with the stored response instead of a fixed (user, endpoint) tuple.
DROP TABLE "IdempotencyRecord";

CREATE TABLE "idempotency_keys" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("scope", "key")
);

CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- ============================================================ settings
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
