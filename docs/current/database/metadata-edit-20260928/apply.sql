\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
\ir target.sql
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_rw';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN RAISE EXCEPTION 'Unsafe or missing shared writer'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN RAISE EXCEPTION 'Writer membership drift'; END IF;
 IF NOT coalesce(r.rolconfig @> ARRAY['default_transaction_read_only=off','statement_timeout=5s','lock_timeout=2s','idle_in_transaction_session_timeout=15s'],false) THEN RAISE EXCEPTION 'Writer settings drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ee_project_api_create') OR to_regprocedure('ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)') IS NULL THEN RAISE EXCEPTION 'Complete reviewed manual-work writer migration first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.access_roles WHERE code='project_api_author' AND enabled) THEN RAISE EXCEPTION 'Author role missing'; END IF;
 IF EXISTS(SELECT 1 FROM ee.permission_definitions WHERE code IN ('project.update','function.update')) THEN RAISE EXCEPTION 'Metadata actions already exist; inspect and verify, do not overwrite'; END IF;
 IF has_any_column_privilege(r.oid,'ee.projects','UPDATE') OR has_any_column_privilege(r.oid,'ee.business_functions','UPDATE') OR has_any_column_privilege(r.oid,'ee.security_audit_events','SELECT') THEN RAISE EXCEPTION 'Metadata grant baseline differs; review before applying'; END IF;
END $$;
GRANT UPDATE(name,description,lock_version) ON ee.projects,ee.business_functions TO ee_project_api_rw;
GRANT SELECT(id,project_id,actor_id,event_type,function_id,before_state,after_state) ON ee.security_audit_events TO ee_project_api_rw;
INSERT INTO ee.permission_definitions(code,display_name,resource_kind,action,allowed_scopes)
VALUES ('project.update','修改项目资料','project','update',ARRAY['project']::text[]),
       ('function.update','修改功能资料','function','update',ARRAY['project']::text[]);
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM ee.access_roles r CROSS JOIN ee.permission_definitions p
WHERE r.code='project_api_author' AND p.code IN ('project.update','function.update');
\ir assertions.sql
COMMIT;
