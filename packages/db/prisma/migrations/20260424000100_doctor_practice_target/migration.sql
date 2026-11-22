ALTER TABLE "doctor_locations"
  DROP CONSTRAINT "doctor_locations_target_check";

ALTER TABLE "doctor_locations"
  ADD CONSTRAINT "doctor_locations_target_check"
  CHECK ("location_id" IS NOT NULL OR "clinic_organization_id" IS NOT NULL OR "address" IS NOT NULL);
