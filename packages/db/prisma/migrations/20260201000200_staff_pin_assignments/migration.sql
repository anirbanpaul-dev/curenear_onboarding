-- Territory reference for staff accounts. Purely informational: nothing reads it
-- for authorisation, so it can change without touching access rules.
CREATE TABLE "staff_pin_assignments" (
  "id" UUID NOT NULL,
  "staff_user_id" UUID NOT NULL,
  "pin_code" CHAR(6) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "staff_pin_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_pin_assignments_staff_user_id_pin_code_key"
  ON "staff_pin_assignments"("staff_user_id", "pin_code");

CREATE INDEX "staff_pin_assignments_pin_code_idx" ON "staff_pin_assignments"("pin_code");

ALTER TABLE "staff_pin_assignments"
  ADD CONSTRAINT "staff_pin_assignments_staff_user_id_fkey"
  FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
