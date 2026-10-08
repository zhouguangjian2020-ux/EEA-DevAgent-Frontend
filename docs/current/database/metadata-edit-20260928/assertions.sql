-- Read-only assertions, included inside a guarded transaction.
DO $$
DECLARE t record; a record; expected boolean; p text;
BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ee' AND c.relkind IN ('r','p') LOOP
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('ee_project_api_ro',t.oid,p) OR (p IN ('INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('ee_project_api_ro',t.oid,p)) THEN RAISE EXCEPTION 'Reader has write privilege'; END IF;
  END LOOP;
  IF t.relname IN ('projects','business_functions') THEN
   IF has_table_privilege('ee_project_api_rw',t.oid,'UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Writer has broad metadata privilege'; END IF;
   FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped LOOP
    expected := a.attname IN ('name','description','lock_version');
    IF has_column_privilege('ee_project_api_rw',t.oid,a.attname,'UPDATE') IS DISTINCT FROM expected OR has_column_privilege('ee_project_api_rw',t.oid,a.attname,'UPDATE WITH GRANT OPTION') THEN RAISE EXCEPTION 'Unexpected metadata column privilege'; END IF;
   END LOOP;
  END IF;
 END LOOP;
 IF has_table_privilege('ee_project_api_rw','ee.security_audit_events','SELECT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Audit broad privilege'; END IF;
 FOR a IN SELECT attname FROM pg_attribute WHERE attrelid='ee.security_audit_events'::regclass AND attnum>0 AND NOT attisdropped LOOP
  expected := a.attname IN ('id','project_id','actor_id','event_type','function_id','before_state','after_state');
  IF has_column_privilege('ee_project_api_rw','ee.security_audit_events',a.attname,'SELECT') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Audit read privilege drift'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM ee.permission_definitions p JOIN ee.role_permissions rp ON rp.permission_code=p.code JOIN ee.access_roles r ON r.id=rp.role_id
     WHERE r.code='project_api_author' AND r.enabled AND p.enabled AND p.code IN ('project.update','function.update') AND p.resource_kind=split_part(p.code,'.',1) AND p.action='update' AND p.allowed_scopes=ARRAY['project']::text[])<>2 THEN RAISE EXCEPTION 'Metadata author capabilities missing or changed'; END IF;
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='project_api_reader' AND rp.permission_code IN ('project.update','function.update')) THEN RAISE EXCEPTION 'Reader role must not gain metadata writes'; END IF;
END $$;
