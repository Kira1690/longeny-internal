CREATE TYPE "public"."caregiver_consent_type" AS ENUM('care_coordination', 'health_data', 'ai_analysis', 'notifications');--> statement-breakpoint
-- consent_type was varchar(100) behind a length-only validator, so rows exist
-- outside the taxonomy. They are consent records: map them onto the nearest
-- real value and record that we did, never delete them. 'caregiver_access' was
-- the pre-taxonomy spelling of "may I manage this person's care", which is
-- exactly what care_coordination means today.
UPDATE "caregiver_consent"
   SET "consent_type" = 'care_coordination',
       "notes" = COALESCE("notes" || E'\n', '')
                 || '[migration 0004] consent_type migrated from ' || "consent_type"
 WHERE "consent_type" NOT IN ('care_coordination', 'health_data', 'ai_analysis', 'notifications');--> statement-breakpoint
-- Fail loudly rather than silently truncating: if the mapping above missed a
-- value, the transaction aborts here with the offending rows still intact.
DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT consent_type, ', ') INTO stray
    FROM caregiver_consent
   WHERE consent_type NOT IN ('care_coordination', 'health_data', 'ai_analysis', 'notifications');
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'caregiver_consent holds unmapped consent_type values: %', stray;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "caregiver_consent" ALTER COLUMN "consent_type" SET DATA TYPE "public"."caregiver_consent_type" USING "consent_type"::"public"."caregiver_consent_type";
