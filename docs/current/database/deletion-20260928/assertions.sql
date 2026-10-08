-- Post-apply assertions; no business writes.
DO $$
DECLARE t record; a record; expected boolean; p text; c text;
BEGIN
 FOR t IN SELECT oid,relname FROM pg_class WHERE relnamespace='ee'::regnamespace AND relkind IN ('r','p') LOOP
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('ee_project_api_ro',t.oid,p) OR (p IN ('INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('ee_project_api_ro',t.oid,p)) THEN RAISE EXCEPTION 'Reader write privilege'; END IF;
  END LOOP;
  IF has_table_privilege('ee_project_api_rw',t.oid,'UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Broad writer mutation privilege'; END IF;
  FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped LOOP
   expected := (t.relname IN ('projects','business_functions') AND a.attname IN ('name','description','lock_version','archived_at')) OR (t.relname='artifacts' AND a.attname IN ('head_revision_id','archived_at'));
   IF has_column_privilege('ee_project_api_rw',t.oid,a.attname,'UPDATE') IS DISTINCT FROM expected OR has_column_privilege('ee_project_api_rw',t.oid,a.attname,'UPDATE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Writer UPDATE column drift: %.%',t.relname,a.attname; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure) IS DISTINCT FROM '9a9d094614fb147df66a663cb28a43d8' THEN RAISE EXCEPTION 'Review function drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure AND p.prosecdef AND r.rolname='ee_m0_owner' AND p.proconfig=ARRAY['search_path=pg_catalog, ee, pg_temp']::text[]) THEN RAISE EXCEPTION 'Unsafe review function'; END IF;
 IF has_function_privilege('ee_project_api_ro','ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)','EXECUTE') OR NOT has_function_privilege('ee_project_api_rw','ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Review execute grants drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure AND x.grantee=0 AND x.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Public review execute forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ee.prds'::regclass AND conname='prds_uq_0') THEN RAISE EXCEPTION 'Old all-history PRD uniqueness remains'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='ee.artifacts_one_prd_per_function'::regclass AND indisunique AND indisvalid AND pg_get_indexdef(indexrelid) LIKE '%(project_id, function_id)%' AND pg_get_expr(indpred,indrelid)='((type_code = ''PRD''::text) AND (archived_at IS NULL))') THEN RAISE EXCEPTION 'Active PRD uniqueness missing or changed'; END IF;
 FOREACH c IN ARRAY ARRAY['project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive'] LOOP
  IF NOT EXISTS(SELECT 1 FROM ee.permission_definitions p JOIN ee.role_permissions rp ON rp.permission_code=p.code JOIN ee.access_roles r ON r.id=rp.role_id WHERE p.code=c AND p.enabled AND lower(p.resource_kind)||'.'||p.action=c AND p.action='archive' AND p.allowed_scopes=ARRAY['project']::text[] AND r.code='project_api_author' AND r.enabled) THEN RAISE EXCEPTION 'Delete capability missing'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='project_api_reader' AND rp.permission_code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive')) THEN RAISE EXCEPTION 'Reader delete capability forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('prds'),('use_cases'),('functional_requirements'),('fr_allocations'),('artifact_revisions'),('prd_versions'),('uc_versions'),('fr_versions'),('fr_uc_sources'),('allocation_versions'),('allocation_targets'),('security_audit_events'),('review_events')) names(n) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=('ee.'||names.n)::regclass AND tg.tgname='history_guard' AND tg.tgenabled='O' AND tg.tgfoid='ee.reject_history_change()'::regprocedure)) THEN RAISE EXCEPTION 'Immutable history guard missing'; END IF;
END $$;
