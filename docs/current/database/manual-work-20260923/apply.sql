\set ON_ERROR_STOP on
-- DBA-reviewed, one-time migration. Any failure rolls back the rename AND grants.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
\ir 005_target.sql
SELECT pg_advisory_xact_lock(hashtextextended('ee.manual_work.writer-rename-r2',0));
SET LOCAL ee.manual_migration='writer-rename-r2';
\ir 004_verify_reader.sql
\ir 001_business_writer.sql
\ir 002_verify.sql
\ir 004_verify_reader.sql
COMMIT;
