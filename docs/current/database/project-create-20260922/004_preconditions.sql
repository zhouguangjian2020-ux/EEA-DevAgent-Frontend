-- Does not create/re-enable users, roles, memberships, or sample data.
DO $preconditions$
DECLARE reader uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ee.app_users WHERE external_subject='engineer01' AND state='active') THEN
  RAISE EXCEPTION 'Existing active engineer01 mapping required';
 END IF;
 SELECT id INTO reader FROM ee.access_roles WHERE code='project_api_reader' AND enabled;
 IF reader IS NULL OR (SELECT count(*) FROM ee.role_permissions WHERE role_id=reader)<>1
 OR NOT EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.permission_definitions p ON p.code=rp.permission_code
  WHERE rp.role_id=reader AND p.code='project.read' AND p.enabled AND p.resource_kind='project' AND p.action='read' AND 'project'=ANY(p.allowed_scopes)) THEN
  RAISE EXCEPTION 'Expected project_api_reader role with exactly project.read';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.projects WHERE id='10d4c8a0-ff3a-56c3-abf6-18dc3b531e62' AND code='XRAY-DVR-SAMPLE' AND name='测试项目1' AND archived_at IS NULL) THEN
  RAISE EXCEPTION 'Reviewed existing sample project missing or changed; stop';
 END IF;
 RAISE NOTICE 'CREATE PRECONDITIONS: PASS; existing user and read role; no business data changed';
END $preconditions$;
