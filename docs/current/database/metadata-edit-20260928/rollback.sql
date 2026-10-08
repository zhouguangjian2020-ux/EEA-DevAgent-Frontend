\set ON_ERROR_STOP on
-- Disable new application writes first. Metadata values and audit/history stay intact.
BEGIN;
SET LOCAL lock_timeout='2s';
\ir target.sql
\ir assertions.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE rp.permission_code IN ('project.update','function.update') AND r.code<>'project_api_author') THEN RAISE EXCEPTION 'Other roles now depend on metadata actions; review rollback'; END IF;
END $$;
DELETE FROM ee.role_permissions WHERE permission_code IN ('project.update','function.update');
DELETE FROM ee.permission_definitions WHERE code IN ('project.update','function.update');
REVOKE UPDATE(name,description,lock_version) ON ee.projects,ee.business_functions FROM ee_project_api_rw;
REVOKE SELECT(id,project_id,actor_id,event_type,function_id,before_state,after_state) ON ee.security_audit_events FROM ee_project_api_rw;
COMMIT;
