\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
LOCK TABLE ee.prd_creation_intents IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.prd_creation_intents) THEN
 RAISE EXCEPTION 'Intent data exists; retain schema and receipts, no destructive rollback'; END IF;
END $$;
DROP TABLE ee.prd_creation_intents;
COMMIT;
