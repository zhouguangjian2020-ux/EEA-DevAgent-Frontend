\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
\ir baseline.sql
SELECT current_database() AS database,current_setting('ee.expected_system_id') AS system_id,'ready_for_stage2' AS state;
COMMIT;
