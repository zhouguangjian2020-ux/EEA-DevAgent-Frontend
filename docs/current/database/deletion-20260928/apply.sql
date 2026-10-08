\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
\ir target.sql
-- Maintenance required. Freeze target rows and the role registry before baseline checks.
LOCK TABLE ee.projects,ee.business_functions,ee.artifacts,ee.prds,ee.permission_definitions,ee.role_permissions IN ACCESS EXCLUSIVE MODE;
\ir baseline.sql
ALTER TABLE ee.prds DROP CONSTRAINT prds_uq_0;
DROP INDEX ee.artifacts_one_prd_per_function;
CREATE UNIQUE INDEX artifacts_one_prd_per_function ON ee.artifacts(project_id,function_id) WHERE type_code='PRD' AND archived_at IS NULL;
GRANT UPDATE(archived_at) ON ee.projects,ee.business_functions,ee.artifacts TO ee_project_api_rw;
INSERT INTO ee.permission_definitions(code,display_name,resource_kind,action,allowed_scopes)
SELECT lower(kind)||'.archive','删除'||kind,kind,'archive',ARRAY['project']::text[] FROM (VALUES('project'),('function'),('PRD'),('UC'),('FR'),('FR_ALLOCATION')) v(kind);
INSERT INTO ee.role_permissions(role_id,permission_code) SELECT r.id,p.code FROM ee.access_roles r CROSS JOIN ee.permission_definitions p WHERE r.code='project_api_author' AND p.code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive');
\ir review_function.sql
\ir assertions.sql
COMMIT;
