\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
DO $$
DECLARE a record;
BEGIN
 IF to_regclass('ee.chat_tasks') IS NULL THEN RAISE EXCEPTION 'Task table missing'; END IF;
 IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='ee.chat_tasks'::regclass)<>'ee_m0_owner'
 OR NOT has_table_privilege('ee_project_api_ro','ee.chat_tasks','SELECT')
 OR NOT has_table_privilege('ee_project_api_rw','ee.chat_tasks','SELECT')
 OR NOT has_table_privilege('ee_project_api_rw','ee.chat_tasks','INSERT')
 OR has_table_privilege('ee_project_api_ro','ee.chat_tasks','INSERT')
 OR has_table_privilege('ee_project_api_ro','ee.chat_tasks','UPDATE')
 OR has_table_privilege('ee_project_api_ro','ee.chat_tasks','DELETE')
 OR has_table_privilege('ee_project_api_ro','ee.chat_tasks','TRUNCATE')
 OR has_table_privilege('ee_project_api_ro','ee.chat_tasks','TRIGGER')
 OR has_any_column_privilege('ee_project_api_ro','ee.chat_tasks','UPDATE')
 OR has_table_privilege('ee_project_api_rw','ee.chat_tasks','UPDATE')
 OR has_table_privilege('ee_project_api_rw','ee.chat_tasks','DELETE')
 OR has_table_privilege('ee_project_api_rw','ee.chat_tasks','TRUNCATE')
 OR has_table_privilege('ee_project_api_rw','ee.chat_tasks','TRIGGER')
 OR EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
           WHERE c.oid='ee.chat_tasks'::regclass AND x.grantee=0)
 THEN RAISE EXCEPTION 'Unsafe task grants'; END IF;
 FOR a IN SELECT attname FROM pg_attribute WHERE attrelid='ee.chat_tasks'::regclass AND attnum>0 AND NOT attisdropped LOOP
  IF has_column_privilege('ee_project_api_rw','ee.chat_tasks',a.attname,'UPDATE') IS DISTINCT FROM
     (a.attname IN ('stage','status','function_id','result_count','result_refs','receipt_id','updated_at'))
  OR has_column_privilege('ee_project_api_rw','ee.chat_tasks',a.attname,'UPDATE WITH GRANT OPTION')
  THEN RAISE EXCEPTION 'Writer task column grant drift: %',a.attname; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ee.chat_tasks'::regclass AND contype='u'
    AND pg_get_constraintdef(oid) LIKE '%(thread_id, client_request_id)%')
 THEN RAISE EXCEPTION 'Task idempotency key missing'; END IF;
END $$;
SELECT 'TASK_RECORD_SCHEMA_OK' AS result;
ROLLBACK;
