ALTER TABLE "doctor_profiles"
  ADD COLUMN "mobile" TEXT,
  ADD COLUMN "email" TEXT;

ALTER TABLE "doctor_locations"
  ADD COLUMN "practice_type" TEXT,
  ADD COLUMN "address" JSONB,
  ADD COLUMN "public_contact" TEXT;
