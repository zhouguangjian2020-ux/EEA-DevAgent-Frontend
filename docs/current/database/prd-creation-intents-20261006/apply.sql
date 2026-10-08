\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
-- The frozen baseline is read-only and must hold before adding this table.
\ir ../agent-workflows-r1/combined-baseline.sql
CREATE TABLE ee.prd_creation_intents (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES ee.projects(id),
 user_id uuid NOT NULL REFERENCES ee.app_users(id),
 client_request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 prompt text NOT NULL CHECK(length(btrim(prompt)) BETWEEN 1 AND 4000),
 state text NOT NULL CHECK(state IN ('planning','planned','generating','failed','blocked','saved')),
 version bigint NOT NULL DEFAULT 1 CHECK(version > 0),
 definition jsonb CHECK(definition IS NULL OR jsonb_typeof(definition)='object'),
 choice jsonb CHECK(choice IS NULL OR jsonb_typeof(choice)='object'),
 function_id uuid,
 artifact_id uuid,
 revision_id uuid,
 reserved_function_id uuid NOT NULL,
 reserved_artifact_id uuid NOT NULL,
 reserved_revision_id uuid NOT NULL,
 source_hash text,
 lease_token uuid,
 lease_until timestamptz,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,user_id,client_request_id),
 FOREIGN KEY(project_id,function_id) REFERENCES ee.business_functions(project_id,id),
 FOREIGN KEY(project_id,function_id,artifact_id) REFERENCES ee.artifacts(project_id,function_id,id),
 FOREIGN KEY(project_id,function_id,artifact_id,revision_id) REFERENCES ee.artifact_revisions(project_id,function_id,artifact_id,id),
 CHECK((artifact_id IS NULL) = (revision_id IS NULL)),
 CHECK(artifact_id IS NULL OR function_id IS NOT NULL),
 CHECK((state IN ('planning','generating')) = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state <> 'saved' OR (artifact_id IS NOT NULL AND revision_id IS NOT NULL AND function_id IS NOT NULL)),
 CHECK(state <> 'generating' OR (function_id IS NOT NULL AND definition IS NOT NULL))
);
CREATE INDEX prd_creation_owner_idx ON ee.prd_creation_intents(project_id,user_id,created_at DESC);
ALTER TABLE ee.prd_creation_intents OWNER TO ee_m0_owner;
REVOKE ALL ON ee.prd_creation_intents FROM PUBLIC;
GRANT SELECT ON ee.prd_creation_intents TO ee_project_api_ro,ee_project_api_rw;
GRANT INSERT ON ee.prd_creation_intents TO ee_project_api_rw;
GRANT UPDATE(state,version,definition,choice,function_id,artifact_id,revision_id,source_hash,
 lease_token,lease_until,error_code,updated_at) ON ee.prd_creation_intents TO ee_project_api_rw;
COMMIT;
