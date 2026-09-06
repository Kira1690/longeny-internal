-- Make the audit tables append-only in the database, not just by convention.
--
-- `phi_access_log` and `caregiver_consent_audit` are documented as append-only,
-- but nothing enforced it: the service role held UPDATE and DELETE on both, so
-- the same process that writes the access record could rewrite it. An audit
-- trail a compliance reviewer relies on has to be harder to change than the data
-- it describes.
--
-- A trigger is the portable half of the fix. It stops the application, an ORM
-- mistake and an ad-hoc UPDATE alike. It does not stop a superuser, who can drop
-- the trigger — which is why the service must not connect as one. See
-- plan/rro/a4-parent-delivery-design.md and the Week-6 audit notes: the dev
-- database currently runs the app as `longeny`, a superuser, and that is an
-- infrastructure change (a dedicated least-privilege role) rather than a code
-- one.
--
-- Apply:
--   docker exec -i w7pg psql -U longeny -d longeny_core \
--     < apps/user-provider-service/src/db/enforce-append-only.sql

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS phi_access_log_append_only ON phi_access_log;
CREATE TRIGGER phi_access_log_append_only
  BEFORE UPDATE OR DELETE ON phi_access_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DROP TRIGGER IF EXISTS caregiver_consent_audit_append_only ON caregiver_consent_audit;
CREATE TRIGGER caregiver_consent_audit_append_only
  BEFORE UPDATE OR DELETE ON caregiver_consent_audit
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
