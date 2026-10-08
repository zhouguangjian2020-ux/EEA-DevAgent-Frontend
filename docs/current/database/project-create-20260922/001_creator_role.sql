-- New service credential only; no business rows, passwords or reader grants changed.
DO $role$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_create';
 IF FOUND THEN
  IF NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
   RAISE EXCEPTION 'Existing creator role attributes are unsafe; no automatic repair';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN
   RAISE EXCEPTION 'Existing creator role has memberships; stop';
  END IF;
 ELSE
  CREATE ROLE ee_project_api_create LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO ee_project_api_create',current_database());
END $role$;
GRANT USAGE ON SCHEMA ee TO ee_project_api_create;
GRANT SELECT ON ee.projects,ee.app_users,ee.project_members,ee.access_bindings,
 ee.access_roles,ee.role_permissions,ee.permission_definitions,ee.project_subsystem_designs
 TO ee_project_api_create;
GRANT INSERT ON ee.projects,ee.project_members,ee.access_bindings,
 ee.project_subsystem_designs,ee.security_audit_events TO ee_project_api_create;
ALTER ROLE ee_project_api_create SET default_transaction_read_only=off;
ALTER ROLE ee_project_api_create SET statement_timeout='5s';
ALTER ROLE ee_project_api_create SET lock_timeout='2s';
ALTER ROLE ee_project_api_create SET idle_in_transaction_session_timeout='15s';
-- Run 002_verify_creator.sql in this SAME transaction: unexpected old grants abort all changes.
