SELECT set_config('ee.expected_database', :'expected_database', true),
       set_config('ee.expected_system_id', :'expected_system_id', true),
       set_config('ee.expected_port', :'expected_port', true);
DO $$ BEGIN
 IF current_database() <> current_setting('ee.expected_database')
 OR current_database() NOT LIKE 'ee_manual_%'
 OR (SELECT system_identifier::text FROM pg_control_system()) <> current_setting('ee.expected_system_id')
 OR current_setting('ee.expected_system_id') = '7686454253092706426'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('port') <> current_setting('ee.expected_port')
 OR current_setting('ee.expected_port') <> '56431'
 THEN RAISE EXCEPTION 'Disposable localhost test cluster required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
  RAISE EXCEPTION 'Local migration owner required'; END IF;
 IF to_regclass('ee.chat_threads') IS NULL OR to_regclass('ee.chat_turns') IS NULL THEN
  RAISE EXCEPTION 'Workflow baseline required'; END IF;
END $$;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
