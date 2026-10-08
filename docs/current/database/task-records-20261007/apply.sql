\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
DO $$ BEGIN
 IF to_regclass('ee.chat_tasks') IS NOT NULL THEN RAISE EXCEPTION 'Task table already exists; inspect instead of reapplying'; END IF;
 IF NOT has_table_privilege('ee_project_api_ro','ee.chat_threads','SELECT')
 OR NOT has_table_privilege('ee_project_api_rw','ee.chat_turns','INSERT')
 OR has_table_privilege('ee_project_api_ro','ee.chat_turns','INSERT')
 OR has_table_privilege('ee_project_api_ro','ee.chat_turns','UPDATE')
 OR has_table_privilege('ee_project_api_ro','ee.chat_turns','DELETE')
 THEN RAISE EXCEPTION 'Unsafe workflow baseline'; END IF;
END $$;
CREATE TABLE ee.chat_tasks (
 id uuid PRIMARY KEY,
 thread_id uuid NOT NULL REFERENCES ee.chat_threads(id),
 project_id uuid NOT NULL REFERENCES ee.projects(id),
 user_id uuid NOT NULL REFERENCES ee.app_users(id),
 client_request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 task_kind text NOT NULL CHECK(task_kind IN ('PRD','UC','FR','FR_ALLOCATION','UC_DIAGRAM')),
 stage text NOT NULL CHECK(stage IN ('starting','planning','awaiting_choice','creating_function','generating','saving','review','completed')),
 status text NOT NULL CHECK(status IN ('running','waiting_choice','preview','succeeded','empty','failed','needs_verification')),
 function_id uuid,
 result_count integer CHECK(result_count BETWEEN 0 AND 100),
 result_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(result_refs)='array' AND jsonb_array_length(result_refs)<=100 AND pg_column_size(result_refs)<16000),
 receipt_id text CHECK(receipt_id IS NULL OR length(receipt_id) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,client_request_id),
 FOREIGN KEY(project_id,function_id) REFERENCES ee.business_functions(project_id,id),
 CHECK(
  (status='running' AND stage NOT IN ('awaiting_choice','review','completed')
   AND result_count IS NULL AND receipt_id IS NULL AND result_refs='[]'::jsonb)
  OR (status='waiting_choice' AND stage='awaiting_choice'
   AND result_count IS NULL AND receipt_id IS NULL AND result_refs='[]'::jsonb)
  OR (status IN ('failed','needs_verification') AND stage='completed'
   AND result_count IS NULL AND receipt_id IS NULL AND result_refs='[]'::jsonb)
  OR (status='preview' AND stage='review' AND result_count>0
   AND receipt_id IS NOT NULL AND result_refs='[]'::jsonb)
  OR (status='empty' AND stage='completed' AND result_count=0
   AND receipt_id IS NULL AND result_refs='[]'::jsonb)
  OR (status='succeeded' AND stage='completed' AND task_kind IN ('PRD','UC','FR')
   AND result_count>0 AND receipt_id IS NOT NULL
   AND jsonb_array_length(result_refs)=result_count)
 )
);
CREATE INDEX chat_tasks_owner_idx ON ee.chat_tasks(thread_id,created_at,id);
ALTER TABLE ee.chat_tasks OWNER TO ee_m0_owner;
REVOKE ALL ON ee.chat_tasks FROM PUBLIC;
GRANT SELECT ON ee.chat_tasks TO ee_project_api_ro,ee_project_api_rw;
GRANT INSERT ON ee.chat_tasks TO ee_project_api_rw;
GRANT UPDATE(stage,status,function_id,result_count,result_refs,receipt_id,updated_at)
 ON ee.chat_tasks TO ee_project_api_rw;
COMMIT;
