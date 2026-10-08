CREATE OR REPLACE FUNCTION ee.accept_manual_revision(p_project uuid,p_artifact uuid,p_revision uuid,p_actor uuid,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ee,pg_temp AS $$
DECLARE a ee.artifacts; f uuid;
BEGIN
 PERFORM 1 FROM ee.projects WHERE id=p_project AND archived_at IS NULL FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'inactive project' USING ERRCODE='23514'; END IF;
 SELECT function_id INTO f FROM ee.artifacts WHERE id=p_artifact AND project_id=p_project AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'inactive artifact' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM ee.business_functions WHERE id=f AND project_id=p_project AND archived_at IS NULL FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'inactive function' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM ee.artifacts WHERE id=p_artifact AND project_id=p_project AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR a.type_code NOT IN ('PRD','UC','FR') THEN RAISE EXCEPTION 'unsupported artifact' USING ERRCODE='23514'; END IF;
 IF a.head_revision_id IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'stale revision' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM ee.artifacts p WHERE p.id IN (SELECT artifact_id FROM ee.direct_upstreams(p_revision)) ORDER BY p.id FOR SHARE;
 IF EXISTS(SELECT 1 FROM ee.direct_upstreams(p_revision) u JOIN ee.artifacts p ON p.id=u.artifact_id
           WHERE p.archived_at IS NOT NULL OR p.project_id<>p_project OR p.function_id<>a.function_id) THEN
  RAISE EXCEPTION 'inactive upstream' USING ERRCODE='23514';
 END IF;
 INSERT INTO ee.review_events(id,project_id,function_id,artifact_id,revision_id,decision,actor_id,event_no,request_key)
 VALUES(gen_random_uuid(),p_project,a.function_id,p_artifact,p_revision,'accept',p_actor,
  (SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=p_artifact),p_request);
 UPDATE ee.artifacts SET accepted_revision_id=p_revision WHERE id=p_artifact;
END $$;
ALTER FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) OWNER TO ee_m0_owner;
REVOKE ALL ON FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ee.accept_manual_revision(uuid,uuid,uuid,uuid,text) TO ee_project_api_rw;
