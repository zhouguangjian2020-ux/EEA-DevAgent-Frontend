-- SELECT-only effective-privilege verification, including columns and routine access.
DO $verify$
DECLARE
 r oid; t record; p text; expected boolean;
 reads text[] := ARRAY['projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions','business_functions','artifacts','artifact_revisions','prds','prd_versions','use_cases','uc_versions','uc_scenario_items','functional_requirements','fr_versions','fr_uc_sources','project_subsystem_designs','subsystem_design_versions','subsystems','subsystem_version_items','fr_allocations','allocation_versions','allocation_targets'];
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='ee_project_api_ro' AND rolcanlogin AND NOT rolinherit
  AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls;
 IF r IS NULL THEN RAISE EXCEPTION 'reader missing or unsafe'; END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r OR roleid=r) THEN RAISE EXCEPTION 'reader membership'; END IF;
 IF NOT has_database_privilege(r,current_database(),'CONNECT') OR NOT has_schema_privilege(r,'ee','USAGE') THEN RAISE EXCEPTION 'reader missing CONNECT/USAGE'; END IF;
 IF has_database_privilege(r,current_database(),'CREATE') OR EXISTS (
  SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(r,n.oid,'CREATE')
 ) THEN RAISE EXCEPTION 'reader has persistent DDL authority'; END IF;
 FOR t IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   expected := t.nspname='ee' AND p='SELECT' AND t.relname=ANY(reads);
   IF has_table_privilege(r,t.oid,p) IS DISTINCT FROM expected OR has_table_privilege(r,t.oid,p||' WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'reader table privilege drift: %.% %',t.nspname,t.relname,p;
   END IF;
   IF p IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN
    IF has_any_column_privilege(r,t.oid,p) IS DISTINCT FROM expected OR has_any_column_privilege(r,t.oid,p||' WITH GRANT OPTION') THEN
     RAISE EXCEPTION 'reader column privilege drift: %.% %',t.nspname,t.relname,p;
    END IF;
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='ee' AND has_function_privilege(r,f.oid,'EXECUTE')) THEN
  RAISE EXCEPTION 'reader must not execute business routines';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(r,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) THEN
  RAISE EXCEPTION 'reader has unexpected sequence privilege';
 END IF;
 IF (SELECT count(*) FROM ee.role_permissions rp JOIN ee.access_roles ar ON ar.id=rp.role_id WHERE ar.code='project_api_reader')<>1
  OR NOT EXISTS (SELECT 1 FROM ee.access_roles ar JOIN ee.role_permissions rp ON rp.role_id=ar.id
   JOIN ee.permission_definitions pd ON pd.code=rp.permission_code WHERE ar.code='project_api_reader' AND ar.enabled
    AND pd.code='project.read' AND pd.enabled AND pd.resource_kind='project' AND pd.action='read' AND pd.allowed_scopes=ARRAY['project']::text[]) THEN
  RAISE EXCEPTION 'project_api_reader must retain only enabled project.read';
 END IF;
 RAISE NOTICE 'Reader verified: 25 SELECT tables only; no DML/column writes/business routines/persistent DDL';
END $verify$;
