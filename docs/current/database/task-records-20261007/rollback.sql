\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
LOCK TABLE ee.chat_tasks IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.chat_tasks) THEN
  RAISE EXCEPTION 'Task receipts exist; preserve table and inspect instead of rollback'; END IF;
END $$;
DROP TABLE ee.chat_tasks;
COMMIT;
