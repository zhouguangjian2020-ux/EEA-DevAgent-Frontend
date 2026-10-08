-- Read-only verification for the backend project workspace aggregation.
-- Run by the controlled DBA helper; the API role itself never receives DDL.
DO $verify$
DECLARE
 role_oid oid;
 allowed text[] := ARRAY[
  'projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions',
  'business_functions','artifacts','artifact_revisions','prds','prd_versions','use_cases','uc_versions','uc_scenario_items',
  'functional_requirements','fr_versions','fr_uc_sources','project_subsystem_designs','subsystem_design_versions','subsystems',
  'subsystem_version_items','fr_allocations','allocation_versions','allocation_targets'
 ];
 table_name text;
BEGIN
 SELECT oid INTO role_oid
 FROM pg_roles
 WHERE rolname='ee_project_api_ro'
   AND rolcanlogin
   AND NOT rolsuper
   AND NOT rolcreatedb
   AND NOT rolcreaterole
   AND NOT rolreplication
   AND NOT rolbypassrls
   AND NOT rolinherit;
 IF role_oid IS NULL THEN RAISE EXCEPTION 'ee_project_api_ro has unexpected role attributes or is missing'; END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=role_oid OR roleid=role_oid) THEN
  RAISE EXCEPTION 'ee_project_api_ro has unexpected role membership';
 END IF;
 IF NOT has_database_privilege(role_oid,current_database(),'CONNECT') THEN
  RAISE EXCEPTION 'ee_project_api_ro lacks CONNECT';
 END IF;
 IF NOT has_schema_privilege(role_oid,'ee','USAGE') THEN
  RAISE EXCEPTION 'ee_project_api_ro lacks ee schema USAGE';
 END IF;
 IF EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='ee' AND c.relkind IN ('r','p')
    AND (has_table_privilege(role_oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR (has_table_privilege(role_oid,c.oid,'SELECT') AND NOT (c.relname=ANY(allowed))))
 ) THEN
  RAISE EXCEPTION 'ee_project_api_ro has an unexpected table privilege';
 END IF;
 FOREACH table_name IN ARRAY allowed LOOP
  IF NOT has_table_privilege(role_oid,format('ee.%I',table_name),'SELECT') THEN
   RAISE EXCEPTION 'ee_project_api_ro lacks SELECT on ee.%', table_name;
  END IF;
 END LOOP;
 RAISE NOTICE 'DB reader grants: PASS; 25 tables SELECT only; no DML, memberships, or elevated attributes';
END $verify$;
SELECT table_name
FROM information_schema.table_privileges
WHERE grantee='ee_project_api_ro' AND table_schema='ee' AND privilege_type='SELECT'
ORDER BY table_name;