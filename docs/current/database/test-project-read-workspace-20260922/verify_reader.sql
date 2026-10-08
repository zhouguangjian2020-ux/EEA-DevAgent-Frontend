DO $reader$
DECLARE u uuid; rid uuid; pid constant uuid:='10d4c8a0-ff3a-56c3-abf6-18dc3b531e62';
BEGIN
 SELECT id INTO u FROM ee.app_users WHERE external_subject=current_setting('ee.reader_subject') AND state='active';
 SELECT id INTO rid FROM ee.access_roles WHERE code='project_api_reader' AND enabled;
 IF u IS NULL OR rid IS NULL THEN RAISE EXCEPTION 'Reader identity/role missing'; END IF;
 IF (SELECT array_agg(permission_code ORDER BY permission_code) FROM ee.role_permissions WHERE role_id=rid) IS DISTINCT FROM ARRAY['project.read']::text[] THEN RAISE EXCEPTION 'Reader permission set mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.project_members WHERE project_id=pid AND user_id=u AND state='active') THEN RAISE EXCEPTION 'Reader membership missing'; END IF;
 IF (SELECT count(*) FROM ee.access_bindings WHERE project_id=pid AND user_id=u AND role_id=rid AND scope_kind='project')<>1 THEN RAISE EXCEPTION 'Reader binding missing/duplicated'; END IF;
 RAISE NOTICE 'Project reader mapping: PASS; only new grant is project.read on this project';
END $reader$;
