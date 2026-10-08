-- Internal migration fragment; use apply.sql for one atomic transaction and target verification.
-- The old login must still have the exact reviewed project-create grants (8 SELECT / 5 INSERT).
DO $rename$
DECLARE
 r record; t record; fn record; p text; expected boolean; saved_password text;
 reads text[] := ARRAY['projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions','project_subsystem_designs'];
 inserts text[] := ARRAY['projects','project_members','access_bindings','project_subsystem_designs','security_audit_events'];
BEGIN
 IF current_setting('ee.manual_migration',true) IS DISTINCT FROM 'writer-rename-r2' THEN
  RAISE EXCEPTION 'Use apply.sql; this fragment must not run alone';
 END IF;
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_create';
 IF NOT FOUND THEN RAISE EXCEPTION 'Old writer missing; if already migrated, run verify.sql, not apply.sql'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ee_project_api_rw') THEN
  RAISE EXCEPTION 'New writer already exists; do not merge, recreate or overwrite either login';
 END IF;
 IF NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
  RAISE EXCEPTION 'Old writer role attributes are unsafe; no automatic repair';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN
  RAISE EXCEPTION 'Old writer has role memberships';
 END IF;
 IF r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil <= now() THEN
  RAISE EXCEPTION 'Old writer credential is expired';
 END IF;
 -- PostgreSQL clears MD5 passwords on rename: stop, never reset/rotate silently.
 SELECT rolpassword INTO saved_password FROM pg_authid WHERE oid=r.oid;
 IF saved_password IS NULL OR saved_password NOT LIKE 'SCRAM-SHA-256$%' THEN
  RAISE EXCEPTION 'SCRAM password required for unchanged-password rename; unset/MD5/unknown must be reviewed separately';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usesysid=r.oid) THEN
  RAISE EXCEPTION 'Writer sessions still connected; stop/drain application writes before rename';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=r.oid
  AND ((dbid<>0 AND dbid<>(SELECT oid FROM pg_database WHERE datname=current_database()))
   OR (dbid=0 AND classid='pg_database'::regclass AND objid<>(SELECT oid FROM pg_database WHERE datname=current_database())))) THEN
  RAISE EXCEPTION 'Writer has dependencies in another database; cluster-wide rename needs separate review';
 END IF;
 IF has_database_privilege(r.oid,current_database(),'CREATE') OR EXISTS (
  SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(r.oid,n.oid,'CREATE')
 ) THEN RAISE EXCEPTION 'Old writer has unexpected persistent DDL authority'; END IF;
 IF NOT has_database_privilege(r.oid,current_database(),'CONNECT') OR NOT has_schema_privilege(r.oid,'ee','USAGE') THEN
  RAISE EXCEPTION 'Old writer missing CONNECT/USAGE';
 END IF;
 IF NOT coalesce(r.rolconfig @> ARRAY['default_transaction_read_only=off','statement_timeout=5s','lock_timeout=2s','idle_in_transaction_session_timeout=15s'],false) THEN
  RAISE EXCEPTION 'Old writer role defaults differ from reviewed limits';
 END IF;
 FOR t IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   expected := t.nspname='ee' AND ((p='SELECT' AND t.relname=ANY(reads)) OR (p='INSERT' AND t.relname=ANY(inserts)));
   IF has_table_privilege(r.oid,t.oid,p) IS DISTINCT FROM expected OR has_table_privilege(r.oid,t.oid,p||' WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'Old writer table privilege drift: %.% %',t.nspname,t.relname,p;
   END IF;
   IF p IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN
    IF has_any_column_privilege(r.oid,t.oid,p) IS DISTINCT FROM expected
     OR has_any_column_privilege(r.oid,t.oid,p||' WITH GRANT OPTION') THEN
     RAISE EXCEPTION 'Old writer column privilege drift: %.% %',t.nspname,t.relname,p;
    END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOR fn IN SELECT f.oid FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='ee' LOOP
  IF has_function_privilege(r.oid,fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'Old writer has unexpected routine privilege'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE false END) THEN
  RAISE EXCEPTION 'Old writer has unexpected sequence privilege';
 END IF;
 ALTER ROLE ee_project_api_create RENAME TO ee_project_api_rw;
 IF NOT EXISTS (SELECT 1 FROM pg_authid WHERE oid=r.oid AND rolname='ee_project_api_rw' AND rolpassword=saved_password) THEN
  RAISE EXCEPTION 'Role identity/password changed unexpectedly; rollback';
 END IF;
 RAISE NOTICE 'Writer renamed in-place; OID and SCRAM verifier preserved; no password displayed';
END $rename$;
GRANT SELECT ON ee.projects,ee.app_users,ee.project_members,ee.access_bindings,ee.access_roles,ee.role_permissions,ee.permission_definitions,ee.project_subsystem_designs,ee.business_functions,ee.artifact_types,ee.artifact_type_versions,ee.artifacts,ee.artifact_revisions,ee.prds,ee.prd_versions,ee.use_cases,ee.uc_versions,ee.uc_scenario_items,ee.functional_requirements,ee.fr_versions,ee.fr_uc_sources,ee.fr_allocations,ee.allocation_versions,ee.review_events TO ee_project_api_rw;
GRANT INSERT ON ee.projects,ee.project_members,ee.access_bindings,ee.project_subsystem_designs,ee.security_audit_events,ee.business_functions,ee.artifacts,ee.artifact_revisions,ee.prds,ee.prd_versions,ee.use_cases,ee.uc_versions,ee.uc_scenario_items,ee.functional_requirements,ee.fr_versions,ee.fr_uc_sources TO ee_project_api_rw;
GRANT UPDATE(head_revision_id) ON ee.artifacts TO ee_project_api_rw;
-- Pure predicate used by R2 triggers; always false for this non-superuser login.
GRANT EXECUTE ON FUNCTION ee.controlled_import() TO ee_project_api_rw;

-- R2 check_review takes SHARE locks on authorization rows. A narrow function keeps
-- that locking authority in the owner, rather than granting the API UPDATE on ACL tables.
CREATE OR REPLACE FUNCTION ee.accept_manual_revision(p_project uuid,p_artifact uuid,p_revision uuid,p_actor uuid,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ee,pg_temp AS $$
DECLARE a ee.artifacts;
BEGIN
 SELECT * INTO a FROM ee.artifacts WHERE id=p_artifact AND project_id=p_project AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR a.type_code NOT IN ('PRD','UC','FR') THEN RAISE EXCEPTION 'unsupported artifact' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.business_functions WHERE id=a.function_id AND archived_at IS NULL) THEN
  RAISE EXCEPTION 'archived function' USING ERRCODE='23514';
 END IF;
 IF a.head_revision_id IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'stale revision' USING ERRCODE='23514'; END IF;
 INSERT INTO ee.review_events(id,project_id,function_id,artifact_id,revision_id,decision,actor_id,event_no,request_key)
 VALUES(gen_random_uuid(),p_project,a.function_id,p_artifact,p_revision,'accept',p_actor,
  (SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=p_artifact),p_request);
 UPDATE ee.artifacts SET accepted_revision_id=p_revision WHERE id=p_artifact;
END $$;
ALTER FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) OWNER TO ee_m0_owner;
REVOKE ALL ON FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) TO ee_project_api_rw;

-- Business role is distinct from a PostgreSQL service credential. No existing reader role is expanded.
INSERT INTO ee.permission_definitions(code,display_name,resource_kind,action,allowed_scopes)
SELECT lower(resource)||'.'||action,resource||' '||action,resource,action,ARRAY['project']::text[]
FROM (VALUES('function','create'),('PRD','create'),('PRD','update'),('PRD','accept'),
 ('UC','create'),('UC','update'),('UC','accept'),('FR','create'),('FR','update'),('FR','accept')) x(resource,action)
ON CONFLICT(code) DO NOTHING;
INSERT INTO ee.access_roles(id,code,name,description,is_system)
VALUES('e55f1a65-1914-4c02-a8e2-74cc2b4c6623','project_api_author','项目需求维护者','手动功能/PRD/UC/FR创建、修订与接受；无权限管理或删除',true)
ON CONFLICT(code) DO NOTHING;
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM ee.access_roles r CROSS JOIN ee.permission_definitions p
WHERE r.code='project_api_author' AND p.code=ANY(ARRAY['project.read','function.create','prd.create','prd.update','prd.accept','uc.create','uc.update','uc.accept','fr.create','fr.update','fr.accept'])
ON CONFLICT DO NOTHING;
