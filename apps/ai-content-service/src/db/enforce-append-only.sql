-- Make this service's audit table append-only in the database, not just by
-- convention. Same reasoning as user-provider's copy: the process that writes
-- the access record must not be able to rewrite it.
--
-- The trigger stops the application, an ORM mistake and an ad-hoc UPDATE alike.
-- It does not stop a superuser, who can drop it — which is why the service must
-- not connect as one. The dev database still runs the app as `longeny`, a
-- superuser; a dedicated least-privilege role is an infrastructure change.
--
-- Apply:
--   docker exec -i w7pg psql -U longeny -d longeny_ai_content \
--     < apps/ai-content-service/src/db/enforce-append-only.sql

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
