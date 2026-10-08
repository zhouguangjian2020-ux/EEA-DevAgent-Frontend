-- A controlled DBA change, not an application write API. IDs and all content stay unchanged.
DO $prepare$
DECLARE
 pid constant uuid := '10d4c8a0-ff3a-56c3-abf6-18dc3b531e62';
 fid constant uuid := '29fe01ea-f727-58cf-a326-b75294ba4dbb';
 subject text := current_setting('ee.reader_subject');
 actor uuid; reader uuid; reader_state text; reader_role_id uuid;
 old_project text; old_function text; changed boolean := false;
BEGIN
 IF length(btrim(subject))=0 OR length(subject)>100 OR subject LIKE 'manual:ssh:%' THEN
  RAISE EXCEPTION 'An explicit real authenticated subject is required; do not reuse the DBA importer';
 END IF;
 SELECT id INTO actor FROM ee.app_users WHERE external_subject=current_setting('ee.import_subject') AND state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'Existing active DBA/importer identity required'; END IF;
 SELECT name INTO old_project FROM ee.projects WHERE id=pid AND code='XRAY-DVR-SAMPLE' AND archived_at IS NULL FOR UPDATE;
 SELECT name INTO old_function FROM ee.business_functions WHERE id=fid AND project_id=pid AND code='DVR-301' AND archived_at IS NULL FOR UPDATE;
 IF old_project IS NULL OR old_function IS NULL THEN RAISE EXCEPTION 'Reviewed sample project/function missing or archived; no empty project will be invented'; END IF;
 IF old_project NOT IN ('X光DVR样本项目','测试项目1') OR old_function NOT IN ('行车记录仪DVR功能','行车记录仪DVR') THEN
  RAISE EXCEPTION 'Unexpected existing names; review before overwrite';
 END IF;
 IF EXISTS(SELECT 1 FROM ee.projects WHERE name='测试项目1' AND id<>pid) THEN RAISE EXCEPTION 'Another project already uses 测试项目1; stop rather than merge'; END IF;
 IF (SELECT count(*) FROM ee.business_functions WHERE project_id=pid)<>1 THEN RAISE EXCEPTION 'Expected exactly one function'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.permission_definitions WHERE code='project.read' AND enabled AND resource_kind='project' AND action='read' AND 'project'=ANY(allowed_scopes)) THEN
  RAISE EXCEPTION 'Expected project.read permission definition is not active';
 END IF;
 IF old_project<>'测试项目1' THEN
  UPDATE ee.projects SET name='测试项目1',lock_version=lock_version+1 WHERE id=pid;
  changed := true;
 END IF;
 IF old_function<>'行车记录仪DVR' THEN
  UPDATE ee.business_functions SET name='行车记录仪DVR',lock_version=lock_version+1 WHERE id=fid;
  changed := true;
 END IF;
 SELECT id,state INTO reader,reader_state FROM ee.app_users WHERE external_subject=subject FOR UPDATE;
 IF reader IS NULL THEN
  INSERT INTO ee.app_users(id,external_subject,display_name,state) VALUES(gen_random_uuid(),subject,subject,'active') RETURNING id INTO reader;
  changed := true;
 ELSIF reader_state<>'active' THEN RAISE EXCEPTION 'Reader is disabled; do not reactivate implicitly';
 END IF;
 SELECT id INTO reader_role_id FROM ee.access_roles WHERE code='project_api_reader';
 IF reader_role_id IS NULL THEN
  INSERT INTO ee.access_roles(id,code,name,description,is_system) VALUES(gen_random_uuid(),'project_api_reader','项目API只读','仅project.read，不授予正文/接受/写入能力',true) RETURNING id INTO reader_role_id;
  INSERT INTO ee.role_permissions(role_id,permission_code) VALUES(reader_role_id,'project.read');
  changed := true;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM ee.access_roles WHERE id=reader_role_id AND enabled) THEN
   RAISE EXCEPTION 'Unexpected disabled project API role';
  END IF;
  IF (SELECT array_agg(rp.permission_code ORDER BY rp.permission_code) FROM ee.role_permissions rp WHERE rp.role_id=reader_role_id) IS DISTINCT FROM ARRAY['project.read']::text[] THEN
   RAISE EXCEPTION 'Existing role has unexpected permissions; no privileges changed';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.project_members WHERE project_id=pid AND user_id=reader) THEN
  INSERT INTO ee.project_members(project_id,user_id,added_by) VALUES(pid,reader,actor);
  changed := true;
 ELSIF NOT EXISTS(SELECT 1 FROM ee.project_members WHERE project_id=pid AND user_id=reader AND state='active') THEN
  RAISE EXCEPTION 'Existing project member disabled; stop';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.access_bindings b WHERE b.project_id=pid AND b.user_id=reader AND b.scope_kind='project' AND b.role_id=reader_role_id) THEN
  INSERT INTO ee.access_bindings(id,project_id,user_id,scope_kind,role_id,created_by,updated_by) VALUES(gen_random_uuid(),pid,reader,'project',reader_role_id,actor,actor);
  changed := true;
 END IF;
 IF changed THEN
  INSERT INTO ee.security_audit_events(id,project_id,actor_id,subject_user_id,event_type,scope_kind,before_state,after_state,reason,request_id)
  VALUES(gen_random_uuid(),pid,actor,reader,'sample_project.read_setup','project',
   jsonb_build_object('project_name',old_project,'function_name',old_function),
   jsonb_build_object('project_name','测试项目1','function_name','行车记录仪DVR','reader_subject',subject,'granted_role','project_api_reader'),
   '用户要求复用样本项目并配置项目只读接口；保留所有对象和版本关联','test-project-read-20260922');
 END IF;
 RAISE NOTICE 'Test project ready. Identity/references unchanged; no business object accepted.';
END $prepare$;
