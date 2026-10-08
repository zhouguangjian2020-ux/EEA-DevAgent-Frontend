\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
\ir target.sql
SELECT set_config('ee.bind_subject', :'expected_subject', true);
DO $$
DECLARE
 actor uuid;
 author_role uuid;
 project_row record;
 binding_count integer;
 existing_role text;
 changed_count integer := 0;
 project_count integer := 0;
BEGIN
 SELECT u.id INTO actor
 FROM ee.app_users u
 WHERE u.external_subject=current_setting('ee.bind_subject')
   AND u.state='active';
 IF actor IS NULL THEN
  RAISE EXCEPTION 'Active subject not found';
 END IF;
 SELECT id INTO author_role
 FROM ee.access_roles
 WHERE code='project_api_author' AND enabled;
 IF author_role IS NULL THEN
  RAISE EXCEPTION 'project_api_author role not ready';
 END IF;
 IF EXISTS (
  SELECT 1
  FROM ee.projects p
  WHERE p.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM ee.project_members m
      WHERE m.project_id=p.id
        AND m.user_id=actor
        AND m.state='active'
    )
 ) THEN
  RAISE EXCEPTION 'Active projects missing an active membership for expected_subject; no membership was added automatically';
 END IF;
 FOR project_row IN
  SELECT p.id, p.name
  FROM ee.projects p
  WHERE p.archived_at IS NULL
  ORDER BY p.id
 LOOP
  project_count := project_count + 1;
  PERFORM pg_advisory_xact_lock(hashtextextended(project_row.id::text || actor::text, 0));
  SELECT count(*), max(r.code)
  INTO binding_count, existing_role
  FROM ee.access_bindings b
  LEFT JOIN ee.access_roles r ON r.id=b.role_id
  WHERE b.project_id=project_row.id
    AND b.user_id=actor
    AND b.scope_kind='project';
  IF binding_count > 1 THEN
   RAISE EXCEPTION 'Multiple project bindings found for expected_subject in project %', project_row.id;
  END IF;
  IF binding_count=1 AND (existing_role IS NULL OR existing_role NOT IN ('project_api_reader','project_api_author')) THEN
   RAISE EXCEPTION 'Non-reader project role requires explicit review in project %', project_row.id;
  END IF;
  IF binding_count=1 AND existing_role='project_api_author' THEN
   CONTINUE;
  ELSIF binding_count=1 THEN
   UPDATE ee.access_bindings
   SET role_id=author_role, updated_by=actor, updated_at=clock_timestamp()
   WHERE project_id=project_row.id
     AND user_id=actor
     AND scope_kind='project';
  ELSE
   INSERT INTO ee.access_bindings(
    id,project_id,user_id,scope_kind,role_id,created_by,updated_by
   ) VALUES (
    gen_random_uuid(),project_row.id,actor,'project',author_role,actor,actor
   );
  END IF;
  INSERT INTO ee.security_audit_events(
   id,project_id,actor_id,subject_user_id,event_type,scope_kind,
   before_state,after_state,reason
  ) VALUES (
   gen_random_uuid(),project_row.id,actor,actor,'project_author.grant','project',
   CASE WHEN binding_count=1 THEN jsonb_build_object('role_code',existing_role) ELSE NULL END,
   jsonb_build_object('role_code','project_api_author'),
   '将指定活跃成员绑定为全部现有项目的项目管理员；不新增成员资格'
  );
  changed_count := changed_count + 1;
 END LOOP;
 RAISE NOTICE 'project_count=%, changed_count=%', project_count, changed_count;
END $$;
COMMIT;