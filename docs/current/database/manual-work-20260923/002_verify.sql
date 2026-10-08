-- No data changes. Abort the grant transaction on unexpected privileges.
DO $$
DECLARE r oid;t record;col record;fn record;p text;expected boolean;
reads text[]:=ARRAY['projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions','project_subsystem_designs','business_functions','artifact_types','artifact_type_versions','artifacts','artifact_revisions','prds','prd_versions','use_cases','uc_versions','uc_scenario_items','functional_requirements','fr_versions','fr_uc_sources','fr_allocations','allocation_versions','review_events'];
inserts text[]:=ARRAY['projects','project_members','access_bindings','project_subsystem_designs','security_audit_events','business_functions','artifacts','artifact_revisions','prds','prd_versions','use_cases','uc_versions','uc_scenario_items','functional_requirements','fr_versions','fr_uc_sources'];
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='ee_project_api_rw' AND rolcanlogin AND NOT rolinherit
  AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls;
 IF r IS NULL THEN RAISE EXCEPTION 'writer missing or unsafe'; END IF;
 IF NOT has_database_privilege(r,current_database(),'CONNECT') OR NOT has_schema_privilege(r,'ee','USAGE') THEN
  RAISE EXCEPTION 'writer missing CONNECT/USAGE';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_authid a JOIN pg_roles pr ON pr.oid=a.oid
  WHERE a.oid=r AND a.rolpassword LIKE 'SCRAM-SHA-256$%'
  AND (a.rolvaliduntil IS NULL OR a.rolvaliduntil>now())
  AND pr.rolconfig @> ARRAY['default_transaction_read_only=off','statement_timeout=5s','lock_timeout=2s','idle_in_transaction_session_timeout=15s']) THEN
  RAISE EXCEPTION 'writer credential/defaults mismatch';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ee_project_api_create') THEN RAISE EXCEPTION 'old writer name still exists'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r OR roleid=r) THEN RAISE EXCEPTION 'writer membership'; END IF;
 IF has_database_privilege(r,current_database(),'CREATE') OR EXISTS(SELECT 1 FROM pg_namespace n WHERE nspname!~'^pg_' AND nspname<>'information_schema' AND has_schema_privilege(r,n.oid,'CREATE')) THEN RAISE EXCEPTION 'DDL privilege'; END IF;
 FOR t IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   expected:=t.nspname='ee' AND ((p='SELECT' AND t.relname=ANY(reads)) OR (p='INSERT' AND t.relname=ANY(inserts)));
   IF has_table_privilege(r,t.oid,p) IS DISTINCT FROM expected OR has_table_privilege(r,t.oid,p||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'Unexpected table privilege %.% %',t.nspname,t.relname,p; END IF;
  END LOOP;
  FOR col IN SELECT attname,attnum FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped LOOP
   FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    expected:=t.nspname='ee' AND ((p='SELECT' AND t.relname=ANY(reads)) OR (p='INSERT' AND t.relname=ANY(inserts)) OR (p='UPDATE' AND t.relname='artifacts' AND col.attname='head_revision_id'));
    IF has_column_privilege(r,t.oid,col.attnum,p) IS DISTINCT FROM expected OR has_column_privilege(r,t.oid,col.attnum,p||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'Unexpected column privilege %.% % %',t.nspname,t.relname,col.attname,p; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 FOR fn IN SELECT f.oid,f.proname FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='ee' LOOP
  expected:=fn.oid IN ('ee.controlled_import()'::regprocedure,'ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure);
  IF has_function_privilege(r,fn.oid,'EXECUTE') IS DISTINCT FROM expected OR has_function_privilege(r,fn.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Unexpected routine privilege %',fn.proname; END IF;
 END LOOP;
 IF NOT has_function_privilege(r,'ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'accept function unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl WHERE f.oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure AND acl.grantee=0 AND privilege_type='EXECUTE') THEN RAISE EXCEPTION 'public accept function'; END IF;

 IF NOT EXISTS (SELECT 1 FROM pg_proc f JOIN pg_roles owner ON owner.oid=f.proowner
  WHERE f.oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure
   AND owner.rolname='ee_m0_owner' AND f.prosecdef AND f.proconfig=ARRAY['search_path=pg_catalog, ee, pg_temp']) THEN
  RAISE EXCEPTION 'accept function owner/security/search_path mismatch';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(r,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) THEN
  RAISE EXCEPTION 'writer has unexpected sequence privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ee.access_roles ar JOIN ee.role_permissions rp ON rp.role_id=ar.id
  JOIN ee.permission_definitions pd ON pd.code=rp.permission_code
  WHERE ar.code='project_api_author' AND ar.enabled AND ar.is_system AND pd.code='project.read'
   AND pd.enabled AND pd.resource_kind='project' AND pd.action='read' AND pd.allowed_scopes=ARRAY['project']::text[]) THEN
  RAISE EXCEPTION 'author project.read capability mismatch';
 END IF;
 IF (SELECT count(*) FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='project_api_author')<>11 THEN RAISE EXCEPTION 'author role must have exactly 11 permissions'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('function','create'),('PRD','create'),('PRD','update'),('PRD','accept'),('UC','create'),('UC','update'),('UC','accept'),('FR','create'),('FR','update'),('FR','accept')) x(resource,action)
  WHERE NOT EXISTS(SELECT 1 FROM ee.permission_definitions p JOIN ee.role_permissions rp ON rp.permission_code=p.code JOIN ee.access_roles r ON r.id=rp.role_id
   WHERE r.code='project_api_author' AND r.enabled AND p.code=lower(x.resource)||'.'||x.action AND p.resource_kind=x.resource AND p.action=x.action AND p.enabled AND p.allowed_scopes=ARRAY['project']::text[])) THEN RAISE EXCEPTION 'author capability mismatch'; END IF;
 RAISE NOTICE 'ee_project_api_rw verified: 24 SELECT, 16 INSERT tables, head_revision_id-only UPDATE, narrow accept function; old login absent';
END $$;
