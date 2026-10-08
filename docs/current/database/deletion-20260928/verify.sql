\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
\ir assertions.sql
SELECT 'stage2_verified' AS state;
COMMIT;
