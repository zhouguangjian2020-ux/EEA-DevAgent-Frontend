-- Pre-apply / post-rollback assertions. Read-only; not an entrypoint.
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_rw';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN RAISE EXCEPTION 'Unsafe shared writer'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN RAISE EXCEPTION 'Writer membership drift'; END IF;
 IF NOT coalesce(r.rolconfig @> ARRAY['default_transaction_read_only=off','statement_timeout=5s','lock_timeout=2s','idle_in_transaction_session_timeout=15s'],false) THEN RAISE EXCEPTION 'Writer settings drift'; END IF;
 IF EXISTS(SELECT 1 FROM ee.permission_definitions WHERE code IN ('project.archive','function.archive','prd.archive','uc.archive','fr.archive','fr_allocation.archive')) THEN RAISE EXCEPTION 'Deletion actions already present; refuse repeated/partial application'; END IF;
 IF has_column_privilege('ee_project_api_rw','ee.projects','archived_at','UPDATE') OR has_column_privilege('ee_project_api_rw','ee.business_functions','archived_at','UPDATE') OR has_column_privilege('ee_project_api_rw','ee.artifacts','archived_at','UPDATE') THEN RAISE EXCEPTION 'Archive grants baseline drift'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)'::regprocedure) IS DISTINCT FROM 'e8019878bd92c5664a1490b32d6df252' THEN RAISE EXCEPTION 'Review function baseline drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ee.prds'::regclass AND conname='prds_uq_0' AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (project_id, function_id)') THEN RAISE EXCEPTION 'PRD typed identity baseline drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='ee.artifacts_one_prd_per_function'::regclass AND indisunique AND indisvalid AND pg_get_indexdef(indexrelid) LIKE '%(project_id, function_id)%' AND pg_get_expr(indpred,indrelid)='(type_code = ''PRD''::text)') THEN RAISE EXCEPTION 'PRD identity index baseline drift'; END IF;
END $$;
\ir ../metadata-edit-20260928/assertions.sql
