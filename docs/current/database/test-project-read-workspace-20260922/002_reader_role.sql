-- Dedicated database login, not an app_users or access_roles row. No password is embedded.
DO $role$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_ro';
 IF FOUND THEN
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit OR NOT r.rolcanlogin THEN
   RAISE EXCEPTION 'Existing DB role has unexpected attributes; stop';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN RAISE EXCEPTION 'Unexpected role membership'; END IF;
  IF has_database_privilege(r.oid,current_database(),'CREATE') OR has_schema_privilege(r.oid,'ee','CREATE') THEN RAISE EXCEPTION 'Unexpected CREATE privilege on reader'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ee' AND c.relkind IN ('r','p') AND
    (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR (has_table_privilege(r.oid,c.oid,'SELECT') AND c.relname NOT IN ('projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions',
      'business_functions','artifacts','artifact_revisions','prds','prd_versions','use_cases','uc_versions','uc_scenario_items',
      'functional_requirements','fr_versions','fr_uc_sources','project_subsystem_designs','subsystem_design_versions','subsystems',
      'subsystem_version_items','fr_allocations','allocation_versions','allocation_targets')))) THEN
   RAISE EXCEPTION 'Existing reader grants exceed this read-only API';
  END IF;

 ELSE
  CREATE ROLE ee_project_api_ro LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO ee_project_api_ro',current_database());
END $role$;
GRANT USAGE ON SCHEMA ee TO ee_project_api_ro;
GRANT SELECT ON ee.projects,ee.app_users,ee.project_members,ee.access_bindings,
 ee.access_roles,ee.role_permissions,ee.permission_definitions,
 ee.business_functions,ee.artifacts,ee.artifact_revisions,ee.prds,ee.prd_versions,
 ee.use_cases,ee.uc_versions,ee.uc_scenario_items,ee.functional_requirements,ee.fr_versions,
 ee.fr_uc_sources,ee.project_subsystem_designs,ee.subsystem_design_versions,ee.subsystems,
 ee.subsystem_version_items,ee.fr_allocations,ee.allocation_versions,ee.allocation_targets
 TO ee_project_api_ro;
ALTER ROLE ee_project_api_ro SET default_transaction_read_only=on;
ALTER ROLE ee_project_api_ro SET statement_timeout='5s';
ALTER ROLE ee_project_api_ro SET lock_timeout='2s';
-- An operator sets the password separately using psql \password; never a command-line literal.
