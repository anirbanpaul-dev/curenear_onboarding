-- A single-column index is dead weight when a composite index starts with that column:
-- the planner can use the composite for the same lookups. Dropping these removes write
-- amplification without losing a query path.

DROP INDEX "sessions_user_id_idx";

DROP INDEX "audit_logs_entity_type_entity_id_idx";
DROP INDEX "audit_logs_actor_user_id_idx";
DROP INDEX "audit_logs_action_idx";
