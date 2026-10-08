\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
SELECT set_config('ee.bind_subject', :'expected_subject', true);
DO $$
DECLARE
 actor uuid;
 author_role uuid;
 project_count integer;
 author_count integer;
BEGIN
 SELECT u.id INTO actor
 FROM ee.app_users u
 WHERE u.external_subject=current_setting('ee.bind_subject')
   AND u.state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'Active subject not found'; END IF;
 SELECT id INTO author_role FROM ee.access_roles WHERE code='project_api_author' AND enabled;
 IF author_role IS NULL THEN RAISE EXCEPTION 'project_api_author role not ready'; END IF;
 SELECT count(*) INTO project_count FROM ee.projects WHERE archived_at IS NULL;
 SELECT count(*) INTO author_count
 FROM ee.projects p
 JOIN ee.project_members m ON m.project_id=p.id AND m.user_id=actor AND m.state='active'
 JOIN ee.access_bindings b ON b.project_id=p.id AND b.user_id=actor AND b.scope_kind='project' AND b.role_id=author_role
 WHERE p.archived_at IS NULL;
 IF author_count <> project_count THEN
  RAISE EXCEPTION 'expected_subject is not project_api_author on every active project: % of %', author_count, project_count;
 END IF;
 IF EXISTS (
  SELECT 1 FROM ee.projects p
  WHERE p.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM ee.project_members m
      WHERE m.project_id=p.id AND m.user_id=actor AND m.state='active'
    )
 ) THEN
  RAISE EXCEPTION 'expected_subject is missing active membership on an active project';
 END IF;
END $$;
SELECT 'project-author-all-20260929 verified' AS result;
COMMIT;