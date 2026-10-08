\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.role_permissions rp JOIN ee.access_roles r ON r.id=rp.role_id WHERE rp.permission_code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept') AND r.code NOT IN ('project_api_author','function_editor')) THEN RAISE EXCEPTION 'Later custom-role grants exist: review instead of deleting authorization'; END IF;
 IF EXISTS(SELECT 1 FROM ee.chat_threads) OR EXISTS(SELECT 1 FROM ee.chat_turns) OR EXISTS(SELECT 1 FROM ee.artifact_revisions WHERE type_code='FR_ALLOCATION' AND metadata ? 'manual_mutation_hash') THEN
 RAISE EXCEPTION 'Workflow data exists: keep schema and roll back application only; do not delete business/history data'; END IF;
END $$;
DROP FUNCTION ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text);
DROP TABLE ee.chat_turns;
DROP TABLE ee.chat_threads;
REVOKE INSERT ON ee.fr_allocations,ee.allocation_versions,ee.allocation_targets FROM ee_project_api_rw;
REVOKE UPDATE(lock_version) ON ee.project_subsystem_designs FROM ee_project_api_rw;
DELETE FROM ee.role_permissions WHERE permission_code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept');
DELETE FROM ee.permission_definitions WHERE code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept');
COMMIT;
