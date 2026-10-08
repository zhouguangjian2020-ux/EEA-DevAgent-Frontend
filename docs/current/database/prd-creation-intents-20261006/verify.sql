\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
\ir combined-baseline.sql
DO $$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['chat_threads','chat_turns'] LOOP
  IF to_regclass('ee.'||t) IS NULL THEN RAISE EXCEPTION 'Chat table missing: %',t; END IF;
  IF NOT has_table_privilege('ee_project_api_ro','ee.'||t,'SELECT') OR has_table_privilege('ee_project_api_ro','ee.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') THEN RAISE EXCEPTION 'Unsafe reader: %',t; END IF;
  IF NOT has_table_privilege('ee_project_api_rw','ee.'||t,'SELECT') OR NOT has_table_privilege('ee_project_api_rw','ee.'||t,'INSERT') OR has_table_privilege('ee_project_api_rw','ee.'||t,'UPDATE,DELETE,TRUNCATE,TRIGGER') THEN RAISE EXCEPTION 'Unsafe writer: %',t; END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=to_regclass('ee.'||t)) <> 'ee_m0_owner' THEN RAISE EXCEPTION 'Unexpected owner'; END IF;
 END LOOP;
 IF NOT has_column_privilege('ee_project_api_rw','ee.chat_turns','body','UPDATE') OR NOT has_column_privilege('ee_project_api_rw','ee.chat_turns','status','UPDATE') OR has_column_privilege('ee_project_api_rw','ee.chat_turns','thread_id','UPDATE') OR has_column_privilege('ee_project_api_rw','ee.chat_threads','user_id','UPDATE') THEN RAISE EXCEPTION 'Unsafe chat column grants'; END IF;
 FOREACH t IN ARRAY ARRAY['fr_allocations','allocation_versions','allocation_targets'] LOOP
  IF NOT has_table_privilege('ee_project_api_rw','ee.'||t,'INSERT') OR has_table_privilege('ee_project_api_ro','ee.'||t,'INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unsafe allocation grants'; END IF;
 END LOOP;
 IF NOT has_column_privilege('ee_project_api_rw','ee.project_subsystem_designs','lock_version','UPDATE') OR has_column_privilege('ee_project_api_rw','ee.project_subsystem_designs','current_version_id','UPDATE') THEN RAISE EXCEPTION 'Unsafe catalogue update grant'; END IF;
 IF NOT has_function_privilege('ee_project_api_rw','ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege('ee_project_api_ro','ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe allocation confirmation grants'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can confirm allocations'; END IF;
 FOREACH r IN ARRAY ARRAY['project_api_author','function_editor'] LOOP
  IF (SELECT count(*) FROM ee.role_permissions rp JOIN ee.access_roles a ON a.id=rp.role_id WHERE a.code=r AND rp.permission_code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept'))<>3 THEN RAISE EXCEPTION 'Allocation role incomplete: %',r; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE r.code='project_api_reader' AND rp.permission_code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept')) THEN RAISE EXCEPTION 'Reader role gained allocation writes'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('ee.prd_creation_intents') IS NULL THEN RAISE EXCEPTION 'Missing intent table'; END IF;
 IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='ee.prd_creation_intents'::regclass) <> 'ee_m0_owner'
 OR NOT has_table_privilege('ee_project_api_rw','ee.prd_creation_intents','INSERT')
 OR NOT has_table_privilege('ee_project_api_rw','ee.prd_creation_intents','SELECT')
 OR EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid='ee.prd_creation_intents'::regclass AND a.grantee=0)
 THEN RAISE EXCEPTION 'Unsafe intent owner or ACL'; END IF;
 IF NOT has_table_privilege('ee_project_api_ro','ee.prd_creation_intents','SELECT')
 OR has_table_privilege('ee_project_api_ro','ee.prd_creation_intents','INSERT')
 OR has_any_column_privilege('ee_project_api_ro','ee.prd_creation_intents','UPDATE')
 OR has_table_privilege('ee_project_api_rw','ee.prd_creation_intents','DELETE')
 OR has_column_privilege('ee_project_api_rw','ee.prd_creation_intents','prompt','UPDATE')
 OR NOT has_column_privilege('ee_project_api_rw','ee.prd_creation_intents','state','UPDATE')
 THEN RAISE EXCEPTION 'Unexpected intent grants'; END IF;
END $$;
SELECT 'PRD_INTENT_COMBINED_SCHEMA_OK' AS result;
ROLLBACK;
