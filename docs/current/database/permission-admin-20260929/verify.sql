\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
\ir assertions.sql
SELECT 'permission-admin-20260929 verified' AS result;
COMMIT;
