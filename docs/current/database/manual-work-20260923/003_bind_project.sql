-- DBA-reviewed opt-in for ONE existing project and ONE existing active member.
-- psql -v project_id=<uuid> -v subject=<authenticated-subject> -f 003_bind_project.sql
\set ON_ERROR_STOP on
BEGIN;
\ir 005_target.sql
\ir 002_verify.sql
\ir 004_verify_reader.sql
SELECT set_config('ee.manual_project', :'project_id', true),set_config('ee.manual_subject', :'subject', true);
DO $$ DECLARE actor uuid;proj uuid:=current_setting('ee.manual_project')::uuid;author_role uuid;
BEGIN
 SELECT u.id INTO actor FROM ee.app_users u JOIN ee.project_members m ON m.user_id=u.id AND m.project_id=proj AND m.state='active'
 JOIN ee.projects p ON p.id=m.project_id AND p.archived_at IS NULL WHERE u.external_subject=current_setting('ee.manual_subject') AND u.state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'Existing active project member required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(proj::text||actor::text,0));
 SELECT id INTO author_role FROM ee.access_roles WHERE code='project_api_author' AND enabled;
 IF author_role IS NULL THEN RAISE EXCEPTION 'Author role not ready'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.access_bindings b WHERE b.project_id=proj AND b.user_id=actor AND b.role_id=author_role AND scope_kind='project') THEN
  IF EXISTS(SELECT 1 FROM ee.access_bindings b JOIN ee.access_roles r ON r.id=b.role_id WHERE b.project_id=proj AND b.user_id=actor AND r.code<>'project_api_reader') THEN
   RAISE EXCEPTION 'Existing non-reader role needs explicit review; no automatic replacement';
  END IF;
  UPDATE ee.access_bindings SET role_id=author_role,updated_by=actor WHERE project_id=proj AND user_id=actor AND scope_kind='project';
  IF NOT FOUND THEN
   INSERT INTO ee.access_bindings(id,project_id,user_id,scope_kind,role_id,created_by,updated_by) VALUES(gen_random_uuid(),proj,actor,'project',author_role,actor,actor);
  END IF;
  INSERT INTO ee.security_audit_events(id,project_id,actor_id,subject_user_id,event_type,scope_kind,reason) VALUES(gen_random_uuid(),proj,actor,actor,'manual_work.grant','project','DBA reviewed explicit project author grant');
 END IF;
END $$;
COMMIT;
