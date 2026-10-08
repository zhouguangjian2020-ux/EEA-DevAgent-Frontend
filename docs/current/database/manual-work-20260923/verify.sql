\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir 005_target.sql
\ir 002_verify.sql
\ir 004_verify_reader.sql
COMMIT;
