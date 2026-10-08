\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
\ir assertions.sql
SELECT 'metadata-edit-20260928 verified' AS result;
COMMIT;
