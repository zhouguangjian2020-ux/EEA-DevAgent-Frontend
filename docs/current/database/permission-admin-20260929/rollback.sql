\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
\ir target.sql
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM ee.app_credentials) THEN RAISE EXCEPTION 'Credential rows exist; rollback would destroy login data, stop'; END IF;
 IF EXISTS (SELECT 1 FROM ee.access_bindings WHERE scope_kind='function') THEN RAISE EXCEPTION 'Function permission bindings exist; remove them explicitly before rollback'; END IF;
 IF EXISTS (
   SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id
   WHERE r.code NOT IN ('function_viewer','function_editor')
     AND rp.permission_code IN ('function.read','prd.read','uc.read','fr.read','fr_allocation.read')
 ) THEN RAISE EXCEPTION 'Other roles depend on function-scoped read permissions; review rollback'; END IF;
END $$;
REVOKE SELECT ON ee.app_credentials FROM ee_project_api_ro;
REVOKE SELECT (user_id,login_name) ON ee.app_credentials FROM ee_project_api_rw;
REVOKE INSERT ON ee.app_credentials FROM ee_project_api_rw;
REVOKE UPDATE ON ee.project_members FROM ee_project_api_rw;
REVOKE INSERT,UPDATE,DELETE ON ee.access_bindings FROM ee_project_api_rw;
DELETE FROM ee.role_permissions WHERE role_id IN (SELECT id FROM ee.access_roles WHERE code IN ('function_viewer','function_editor'));
DELETE FROM ee.access_roles WHERE code IN ('function_viewer','function_editor');
UPDATE ee.permission_definitions
SET allowed_scopes=ARRAY['project']::text[], updated_at=clock_timestamp()
WHERE code IN ('function.read','prd.read','uc.read','fr.read','fr_allocation.read');
DELETE FROM ee.permission_definitions WHERE code='project.manage_access';
DROP INDEX ee.access_bindings_one_function_role;
ALTER TABLE ee.access_bindings DROP CONSTRAINT access_bindings_ck_1;
ALTER TABLE ee.access_bindings ADD CONSTRAINT access_bindings_ck_1 CHECK ((scope_kind='project') IS TRUE);
DROP TABLE ee.app_credentials;
COMMIT;
