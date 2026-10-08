\set ON_ERROR_STOP on
-- Stop new writes first. Never delete histories to force a rollback.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
\ir target.sql
LOCK TABLE ee.projects,ee.business_functions,ee.artifacts,ee.prds,ee.permission_definitions,ee.role_permissions IN ACCESS EXCLUSIVE MODE;
\ir assertions.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.prds GROUP BY project_id,function_id HAVING count(*)>1) OR EXISTS(SELECT 1 FROM ee.artifacts WHERE type_code='PRD' GROUP BY project_id,function_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Multiple historical PRD identities exist; destructive rollback forbidden. Keep the schema and roll forward'; END IF;
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE rp.permission_code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive') AND r.code<>'project_api_author') THEN RAISE EXCEPTION 'Other roles depend on deletion capabilities; review rollback'; END IF;
END $$;
DROP INDEX ee.artifacts_one_prd_per_function;
CREATE UNIQUE INDEX artifacts_one_prd_per_function ON ee.artifacts(project_id,function_id) WHERE type_code='PRD';
ALTER TABLE ee.prds ADD CONSTRAINT prds_uq_0 UNIQUE(project_id,function_id);
REVOKE UPDATE(archived_at) ON ee.projects,ee.business_functions,ee.artifacts FROM ee_project_api_rw;
DELETE FROM ee.role_permissions WHERE permission_code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive');
DELETE FROM ee.permission_definitions WHERE code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive');
\ir review_function_before.sql
\ir baseline.sql
COMMIT;
