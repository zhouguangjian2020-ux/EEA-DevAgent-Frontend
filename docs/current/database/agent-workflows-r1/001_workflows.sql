DO $$ BEGIN IF current_setting('ee.workflow_migration',true) IS DISTINCT FROM 'apply-r1' THEN RAISE EXCEPTION 'Use apply.sql with explicit target'; END IF; END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ee.permission_definitions WHERE code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept')) THEN RAISE EXCEPTION 'Partial or existing workflow permission migration; inspect instead of rerun'; END IF;
 IF to_regclass('ee.chat_threads') IS NOT NULL OR to_regclass('ee.chat_turns') IS NOT NULL OR to_regprocedure('ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'Existing workflow schema; inspect instead of rerun'; END IF;
 IF has_table_privilege('ee_project_api_rw','ee.fr_allocations','INSERT') OR has_table_privilege('ee_project_api_rw','ee.allocation_versions','INSERT') OR has_table_privilege('ee_project_api_rw','ee.allocation_targets','INSERT') OR has_column_privilege('ee_project_api_rw','ee.project_subsystem_designs','lock_version','UPDATE') THEN RAISE EXCEPTION 'Unexpected existing workflow write grants; preserve and review baseline'; END IF;
 IF to_regclass('ee.app_credentials') IS NULL THEN RAISE EXCEPTION 'Apply the reviewed account baseline first'; END IF;
END $$;
-- Independent increment; execute only in an approved database as migration owner.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE ee.chat_threads (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES ee.projects(id),
 user_id uuid NOT NULL REFERENCES ee.app_users(id), client_request_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,user_id,client_request_id)
);
CREATE INDEX chat_threads_owner_idx ON ee.chat_threads(project_id,user_id,updated_at DESC);
CREATE TABLE ee.chat_turns (
 id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES ee.chat_threads(id),
 client_request_id uuid NOT NULL, request_hash text NOT NULL,
 prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 20000),
 mode text NOT NULL CHECK(mode IN ('question','modify')),
 attachments jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(attachments)='array'),
 body text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,client_request_id)
);
CREATE INDEX chat_turns_history_idx ON ee.chat_turns(thread_id,created_at,id);
CREATE UNIQUE INDEX chat_turns_running_idx ON ee.chat_turns(thread_id) WHERE status='running';
ALTER TABLE ee.chat_threads OWNER TO ee_m0_owner;
ALTER TABLE ee.chat_turns OWNER TO ee_m0_owner;
REVOKE ALL ON ee.chat_threads,ee.chat_turns FROM PUBLIC;
GRANT SELECT ON ee.chat_threads,ee.chat_turns TO ee_project_api_ro,ee_project_api_rw;
GRANT INSERT ON ee.chat_threads,ee.chat_turns TO ee_project_api_rw;
GRANT UPDATE(title,updated_at) ON ee.chat_threads TO ee_project_api_rw;
GRANT UPDATE(body,status,updated_at) ON ee.chat_turns TO ee_project_api_rw;
GRANT INSERT ON ee.fr_allocations,ee.allocation_versions,ee.allocation_targets TO ee_project_api_rw;
-- Extend only the existing business-author role, never the reader role.
INSERT INTO ee.permission_definitions(code,display_name,resource_kind,action,allowed_scopes)
SELECT 'fr_allocation.'||action,'FR allocation '||action,'FR_ALLOCATION',action,ARRAY['project','function']::text[]
FROM (VALUES('create'),('update'),('accept')) v(action) ON CONFLICT(code) DO NOTHING;
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM ee.access_roles r CROSS JOIN ee.permission_definitions p
WHERE r.code IN ('project_api_author','function_editor') AND p.code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept')
ON CONFLICT DO NOTHING;
GRANT SELECT ON ee.allocation_targets,ee.subsystems,ee.subsystem_version_items,ee.subsystem_design_versions TO ee_project_api_rw;
-- SELECT FOR SHARE needs UPDATE on at least one column; no catalogue pointer grant.
GRANT UPDATE(lock_version) ON ee.project_subsystem_designs TO ee_project_api_rw;
CREATE FUNCTION ee.accept_workflow_allocation(p_project uuid,p_artifact uuid,p_revision uuid,p_actor uuid,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ee,pg_temp AS $$
DECLARE a ee.artifacts;
BEGIN
 SELECT * INTO a FROM ee.artifacts WHERE id=p_artifact AND project_id=p_project AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR a.type_code<>'FR_ALLOCATION' THEN RAISE EXCEPTION 'unsupported allocation' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.business_functions WHERE id=a.function_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'archived function' USING ERRCODE='23514'; END IF;
 IF a.head_revision_id IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'stale revision' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ee.allocation_targets WHERE allocation_revision_id=p_revision) THEN RAISE EXCEPTION 'no targets' USING ERRCODE='23514'; END IF;
 INSERT INTO ee.review_events(id,project_id,function_id,artifact_id,revision_id,decision,actor_id,event_no,request_key)
 VALUES(gen_random_uuid(),p_project,a.function_id,p_artifact,p_revision,'accept',p_actor,
 (SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=p_artifact),p_request);
 UPDATE ee.artifacts SET accepted_revision_id=p_revision WHERE id=p_artifact;
END $$;
ALTER FUNCTION ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text) OWNER TO ee_m0_owner;
REVOKE ALL ON FUNCTION ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text) TO ee_project_api_rw;
