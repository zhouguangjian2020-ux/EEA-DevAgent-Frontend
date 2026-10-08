DO $$
DECLARE role_id uuid; permission_count integer;
BEGIN
 IF to_regclass('ee.app_credentials') IS NULL THEN RAISE EXCEPTION 'app_credentials table missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ee.app_credentials'::regclass AND conname='app_credentials_pk') THEN RAISE EXCEPTION 'credential primary key missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ee.app_credentials'::regclass AND conname='app_credentials_fk_0') THEN RAISE EXCEPTION 'credential user foreign key missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ee.access_bindings'::regclass AND conname='access_bindings_ck_1' AND pg_get_constraintdef(oid) LIKE '%function%') THEN RAISE EXCEPTION 'function scope constraint missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='ee.access_bindings_one_function_role'::regclass AND indisunique AND indisvalid) THEN RAISE EXCEPTION 'function permission uniqueness missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM ee.permission_definitions WHERE code='project.manage_access' AND enabled AND resource_kind='project' AND action='manage_access' AND allowed_scopes=ARRAY['project']::text[]) THEN RAISE EXCEPTION 'project.manage_access missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM ee.access_roles r JOIN ee.role_permissions rp ON rp.role_id=r.id WHERE r.code='project_api_author' AND rp.permission_code='project.manage_access') THEN RAISE EXCEPTION 'project author manage access missing'; END IF;
 FOREACH role_id IN ARRAY ARRAY[(SELECT id FROM ee.access_roles WHERE code='function_viewer'),(SELECT id FROM ee.access_roles WHERE code='function_editor')] LOOP
  IF role_id IS NULL THEN RAISE EXCEPTION 'function role missing'; END IF;
 END LOOP;
 SELECT count(*) INTO permission_count FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='function_viewer';
 IF permission_count <> 5 THEN RAISE EXCEPTION 'function_viewer permission set mismatch'; END IF;
 IF EXISTS (
  SELECT 1
  FROM unnest(ARRAY['fr.read','fr_allocation.read','function.read','prd.read','uc.read']::text[]) AS expected(permission_code)
  WHERE NOT EXISTS (
   SELECT 1 FROM ee.role_permissions rp
   JOIN ee.access_roles r ON r.id=rp.role_id
   WHERE r.code='function_viewer' AND rp.permission_code=expected.permission_code
  )
 ) THEN RAISE EXCEPTION 'function_viewer capabilities mismatch'; END IF;
 SELECT count(*) INTO permission_count FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='function_editor';
 IF permission_count <> 15 THEN RAISE EXCEPTION 'function_editor permission set mismatch'; END IF;
 IF EXISTS (
  SELECT 1
  FROM unnest(ARRAY['fr.accept','fr.create','fr.read','fr.update','fr_allocation.read','function.read','function.update','prd.accept','prd.create','prd.read','prd.update','uc.accept','uc.create','uc.read','uc.update']::text[]) AS expected(permission_code)
  WHERE NOT EXISTS (
   SELECT 1 FROM ee.role_permissions rp
   JOIN ee.access_roles r ON r.id=rp.role_id
   WHERE r.code='function_editor' AND rp.permission_code=expected.permission_code
  )
 ) THEN RAISE EXCEPTION 'function_editor capabilities mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='project_api_reader' AND rp.permission_code='project.manage_access') THEN RAISE EXCEPTION 'project reader gained manage access'; END IF;
 IF has_table_privilege('ee_project_api_ro','ee.app_credentials','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'reader can write credentials'; END IF;
 IF NOT has_column_privilege('ee_project_api_rw','ee.app_credentials','user_id','INSERT')
    OR NOT has_column_privilege('ee_project_api_rw','ee.app_credentials','login_name','INSERT')
    OR NOT has_column_privilege('ee_project_api_rw','ee.app_credentials','password_hash','INSERT')
 THEN RAISE EXCEPTION 'writer cannot create credentials'; END IF;
 IF NOT has_column_privilege('ee_project_api_rw','ee.app_credentials','user_id','SELECT') OR NOT has_column_privilege('ee_project_api_rw','ee.app_credentials','login_name','SELECT') OR has_column_privilege('ee_project_api_rw','ee.app_credentials','password_hash','SELECT') THEN RAISE EXCEPTION 'writer credential lookup privilege mismatch'; END IF;
 IF has_table_privilege('ee_project_api_rw','ee.app_credentials','UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'writer has broad credential privilege'; END IF;
 IF NOT has_table_privilege('ee_project_api_rw','ee.access_bindings','INSERT') THEN RAISE EXCEPTION 'writer cannot create permission bindings'; END IF;
END $$;
