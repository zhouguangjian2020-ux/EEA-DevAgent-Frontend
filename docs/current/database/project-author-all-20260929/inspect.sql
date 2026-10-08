\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
SELECT set_config('ee.bind_subject', :'expected_subject', true);
DO $$
BEGIN
 IF btrim(current_setting('ee.bind_subject', true)) = '' THEN
  RAISE EXCEPTION 'expected_subject is required';
 END IF;
END $$;
SELECT
 p.id AS project_id,
 p.code AS project_code,
 p.name AS project_name,
 u.external_subject,
 u.display_name,
 m.state AS member_state,
 r.code AS project_role
FROM ee.projects p
JOIN ee.project_members m
 ON m.project_id=p.id
JOIN ee.app_users u
 ON u.id=m.user_id
LEFT JOIN ee.access_bindings b
 ON b.project_id=p.id AND b.user_id=u.id AND b.scope_kind='project'
LEFT JOIN ee.access_roles r
 ON r.id=b.role_id
WHERE p.archived_at IS NULL
 AND u.external_subject=current_setting('ee.bind_subject')
ORDER BY p.name, r.code NULLS FIRST;
SELECT count(*) AS active_project_count
FROM ee.projects p
WHERE p.archived_at IS NULL;
SELECT count(*) AS active_projects_with_subject_membership
FROM ee.projects p
JOIN ee.project_members m ON m.project_id=p.id AND m.state='active'
JOIN ee.app_users u ON u.id=m.user_id AND u.state='active'
WHERE p.archived_at IS NULL
 AND u.external_subject=current_setting('ee.bind_subject');
COMMIT;