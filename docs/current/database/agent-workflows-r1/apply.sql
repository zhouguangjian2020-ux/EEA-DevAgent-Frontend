\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
SELECT set_config('ee.workflow_migration','apply-r1',true);
\ir 001_workflows.sql
COMMIT;
