-- R2 acceptance/lifecycle tests. Test helpers are pg_temp only; every write is rolled back.
BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(160921,200);
SET LOCAL ROLE ee_m0_owner;
SET LOCAL search_path=ee,pg_catalog;
SET LOCAL ee.controlled_import='off';
CREATE FUNCTION pg_temp.accept_revision(rid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r ee.artifact_revisions;
BEGIN
 SELECT * INTO STRICT r FROM ee.artifact_revisions WHERE id=rid;
 INSERT INTO ee.review_events(id,project_id,function_id,artifact_id,revision_id,decision,actor_id,event_no,request_key)
 VALUES(gen_random_uuid(),r.project_id,r.function_id,r.artifact_id,r.id,'accept',r.created_by,
  (SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=r.artifact_id),gen_random_uuid()::text);
 UPDATE ee.artifacts SET accepted_revision_id=rid WHERE id=r.artifact_id;
 SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
END $$;
CREATE FUNCTION pg_temp.revise(aid uuid,patch jsonb DEFAULT '{}',sources uuid[] DEFAULT NULL,targets uuid[] DEFAULT NULL,type_id uuid DEFAULT NULL,copy_scenarios boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a ee.artifacts; old ee.artifact_revisions; rid uuid:=gen_random_uuid(); tab text; body jsonb;
BEGIN
 SELECT * INTO STRICT a FROM ee.artifacts WHERE id=aid FOR UPDATE;
 SELECT * INTO STRICT old FROM ee.artifact_revisions WHERE id=a.head_revision_id;
 INSERT INTO ee.artifact_revisions(id,project_id,function_id,artifact_id,type_code,revision_no,base_revision_id,type_version_id,created_by)
 VALUES(rid,a.project_id,a.function_id,a.id,a.type_code,old.revision_no+1,old.id,coalesce(type_id,old.type_version_id),old.created_by);
 tab=CASE a.type_code WHEN 'PRD' THEN 'prd_versions' WHEN 'UC' THEN 'uc_versions' WHEN 'FR' THEN 'fr_versions' ELSE 'allocation_versions' END;
 EXECUTE format('SELECT to_jsonb(x) FROM ee.%I x WHERE revision_id=$1',tab) INTO body USING old.id;
 body=body||patch||jsonb_build_object('revision_id',rid);
 EXECUTE format('INSERT INTO ee.%I SELECT * FROM jsonb_populate_record(NULL::ee.%I,$1)',tab,tab) USING body;
 IF a.type_code='UC' AND copy_scenarios THEN
  INSERT INTO ee.uc_scenario_items SELECT t.project_id,t.function_id,t.uc_id,rid,t.item_id,t.kind,t.category,t.position,t.body FROM ee.uc_scenario_items t WHERE uc_revision_id=old.id;
 ELSIF a.type_code='FR' THEN
  IF sources IS NULL THEN
   INSERT INTO ee.fr_uc_sources SELECT project_id,function_id,rid,uc_id,uc_revision_id,rationale FROM ee.fr_uc_sources WHERE fr_revision_id=old.id;
  ELSE
   INSERT INTO ee.fr_uc_sources SELECT project_id,function_id,rid,uc_id,revision_id,NULL FROM ee.uc_versions WHERE revision_id=ANY(sources);
  END IF;
 ELSIF a.type_code='FR_ALLOCATION' THEN
  IF targets IS NULL THEN
   INSERT INTO ee.allocation_targets SELECT project_id,function_id,rid,design_version_id,subsystem_id,rationale FROM ee.allocation_targets WHERE allocation_revision_id=old.id;
  ELSE
   INSERT INTO ee.allocation_targets SELECT a.project_id,a.function_id,rid,(body->>'design_version_id')::uuid,x,NULL FROM unnest(targets) x;
  END IF;
 END IF;
 UPDATE ee.artifacts SET head_revision_id=rid WHERE id=aid;
 SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
 RETURN rid;
END $$;
CREATE FUNCTION pg_temp.assert_ok(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
DO $tests$
DECLARE sample_project uuid:=(SELECT id FROM ee.projects WHERE code='XRAY-DVR-SAMPLE'); prd ee.artifacts; uc ee.artifacts; fr ee.artifacts; alloc ee.artifacts; r record;
 rid uuid; r2 uuid; r3 uuid; p2 uuid; f2 uuid; old uuid; typ uuid; actor uuid; old_content jsonb; state jsonb; saved boolean:=false; scheme uuid; prior_scheme uuid;
BEGIN
 SELECT * INTO STRICT prd FROM ee.artifacts WHERE project_id=sample_project AND type_code='PRD';
 SELECT * INTO uc FROM ee.artifacts WHERE project_id=sample_project AND type_code='UC' ORDER BY code LIMIT 1;
 SELECT * INTO fr FROM ee.artifacts a WHERE a.project_id=sample_project AND type_code='FR' AND EXISTS(SELECT 1 FROM ee.fr_uc_sources s WHERE s.fr_revision_id=a.head_revision_id AND s.uc_id=uc.id) ORDER BY code LIMIT 1;
 SELECT a.* INTO alloc FROM ee.artifacts a JOIN ee.fr_allocations f ON f.artifact_id=a.id WHERE f.fr_id=fr.id;
 actor=prd.created_by;
 PERFORM pg_temp.assert_ok((SELECT count(*) FROM ee.fr_uc_sources WHERE fr_revision_id=fr.head_revision_id)>=2,'multi-source FR fixture covers every source');
 PERFORM pg_temp.assert_ok((SELECT bool_and(accepted_revision_id IS NULL) FROM ee.artifacts WHERE project_id=sample_project),'imports remain pending');
 BEGIN
  PERFORM pg_temp.accept_revision(prd.head_revision_id);
  RAISE EXCEPTION 'TEST FAILED: read-only importer accepted content';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS read-only importer has no implicit accept permission'; END;
 -- Test-only permission grants, rolled back with every other smoke-test change.
 INSERT INTO ee.permission_definitions(code,display_name,resource_kind,action,allowed_scopes)
 SELECT lower(t)||'.accept','Test accept '||t,t,'accept',ARRAY['project'] FROM unnest(ARRAY['PRD','UC','FR','FR_ALLOCATION']) t;
 INSERT INTO ee.role_permissions(role_id,permission_code)
 SELECT b.role_id,p.code FROM ee.access_bindings b CROSS JOIN ee.permission_definitions p
 WHERE b.project_id=prd.project_id AND b.user_id=actor AND p.action='accept';
 PERFORM pg_temp.assert_ok(NOT ee.nonblank(E' \t\n'||chr(160)||chr(12288)) AND ee.nonblank('正文'),'unicode nonblank without normalization');
 -- Blank drafts must persist structurally, but fail acceptance.
 BEGIN
  saved=false;
  rid=pg_temp.revise(prd.id,jsonb_build_object('markdown_body',E' \n\t'));
  saved=true;
  PERFORM pg_temp.accept_revision(rid);
  RAISE EXCEPTION 'TEST FAILED: blank PRD accepted';
 EXCEPTION WHEN check_violation THEN IF NOT saved THEN RAISE; END IF; RAISE NOTICE 'PASS blank PRD saved but not accepted'; END;
 BEGIN
  saved=false;
  rid=pg_temp.revise(uc.id,jsonb_build_object('name','','description','','main_flow',''),NULL,NULL,NULL,false);
  PERFORM pg_temp.assert_ok((SELECT count(*) FROM jsonb_array_elements(ee.acceptance_issues(rid)) x(value) WHERE x.value->>'code'='required_content')=3,'all three UC content requirements reported');
  saved=true;
  PERFORM pg_temp.accept_revision(rid);
  RAISE EXCEPTION 'TEST FAILED: blank UC accepted';
 EXCEPTION WHEN check_violation THEN IF NOT saved THEN RAISE; END IF; RAISE NOTICE 'PASS blank UC saved but not accepted'; END;
 BEGIN
  saved=false;
  rid=pg_temp.revise(fr.id,'{}',ARRAY[]::uuid[]);
  PERFORM pg_temp.assert_ok(EXISTS(SELECT 1 FROM jsonb_array_elements(ee.acceptance_issues(rid)) x(value) WHERE x.value->>'code'='minimum_items'),'FR minimum source issue');
  saved=true;
  PERFORM pg_temp.accept_revision(rid);
  RAISE EXCEPTION 'TEST FAILED: zero source FR accepted';
 EXCEPTION WHEN check_violation THEN IF NOT saved THEN RAISE; END IF; RAISE NOTICE 'PASS zero source FR saved but not accepted'; END;
 BEGIN
  saved=false;
  rid=pg_temp.revise(alloc.id,'{}',NULL,ARRAY[]::uuid[]);
  PERFORM pg_temp.assert_ok(EXISTS(SELECT 1 FROM jsonb_array_elements(ee.acceptance_issues(rid)) x(value) WHERE x.value->>'code'='minimum_items'),'allocation minimum target issue');
  saved=true;
  PERFORM pg_temp.accept_revision(rid);
  RAISE EXCEPTION 'TEST FAILED: zero target allocation accepted';
 EXCEPTION WHEN check_violation THEN IF NOT saved THEN RAISE; END IF; RAISE NOTICE 'PASS zero target allocation saved but not accepted'; END;
 BEGIN
  PERFORM pg_temp.accept_revision(uc.head_revision_id);
  RAISE EXCEPTION 'TEST FAILED: pending upstream allowed';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS pending PRD blocks UC acceptance'; END;
 BEGIN
  -- A newly selected pending UC is not an ordinary source, even if the draft is incomplete.
  SELECT revision_id INTO rid FROM ee.uc_versions WHERE project_id=sample_project AND uc_id NOT IN(SELECT uc_id FROM ee.fr_uc_sources WHERE fr_revision_id=fr.head_revision_id) LIMIT 1;
  PERFORM pg_temp.revise(fr.id,'{}',ARRAY[rid]);
  RAISE EXCEPTION 'TEST FAILED: pending UC selection allowed';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS D02 pending source selection refused'; END;
 PERFORM pg_temp.accept_revision(prd.head_revision_id);
 FOR r IN SELECT head_revision_id FROM ee.artifacts WHERE project_id=sample_project AND type_code='UC' LOOP PERFORM pg_temp.accept_revision(r.head_revision_id); END LOOP;
 PERFORM pg_temp.assert_ok((SELECT accepted_revision_id FROM ee.artifacts WHERE id=uc.id)=uc.head_revision_id,'sample UC missing slots can be accepted');
 BEGIN
  saved=false;
  rid=pg_temp.revise(fr.id,jsonb_build_object('description',E' \t\n'));
  saved=true;
  PERFORM pg_temp.assert_ok(EXISTS(SELECT 1 FROM jsonb_array_elements(ee.acceptance_issues(rid)) x(value) WHERE x.value->>'code'='required_content'),'FR description nonblank issue');
  PERFORM pg_temp.accept_revision(rid);
  RAISE EXCEPTION 'TEST FAILED: blank FR accepted';
 EXCEPTION WHEN check_violation THEN IF NOT saved THEN RAISE; END IF; RAISE NOTICE 'PASS blank FR description saved but not accepted'; END;
 old_content=ee.revision_document(uc.head_revision_id);
 r2=pg_temp.revise(uc.id,jsonb_build_object('actors_text','','preconditions','','postconditions','','extensions_text','','hmi_logic','','regulations','','performance','','nonfunctional',''),NULL,NULL,NULL,false);
 PERFORM pg_temp.assert_ok((SELECT accepted_revision_id FROM ee.artifacts WHERE id=uc.id)=uc.head_revision_id AND ee.revision_state(r2)->>'review_status'='pending','accepted UC can have a new pending revision');
 PERFORM pg_temp.assert_ok(ee.revision_document(uc.head_revision_id)=old_content,'old accepted content unchanged');
 PERFORM pg_temp.assert_ok(ee.acceptance_issues(fr.head_revision_id)='[]','UC pending r2 does not invalidate r1 FR reference');
 -- A rejection concerns r2 only, never r1's accepted pointer.
 BEGIN
 INSERT INTO ee.review_events(id,project_id,function_id,artifact_id,revision_id,decision,actor_id,event_no,request_key)
 VALUES(gen_random_uuid(),uc.project_id,uc.function_id,uc.id,r2,'reject',actor,2,gen_random_uuid()::text);
 SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.assert_ok((SELECT accepted_revision_id FROM ee.artifacts WHERE id=uc.id)=uc.head_revision_id,'rejecting r2 preserves accepted r1');
  RAISE SQLSTATE 'ZX001' USING MESSAGE='test-only rollback of rejection';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
 PERFORM pg_temp.accept_revision(fr.head_revision_id);
 PERFORM pg_temp.accept_revision(r2);
 PERFORM pg_temp.assert_ok(ee.revision_state(fr.head_revision_id)->>'review_status'='accepted' AND (SELECT accepted_revision_id FROM ee.artifacts WHERE id=fr.id)=fr.head_revision_id,'upstream acceptance does not downgrade accepted FR');
 PERFORM pg_temp.assert_ok(ee.revision_state(fr.head_revision_id)::text LIKE '%"changed": true%','dependency change is separate from acceptance');
 -- A new FR revision carrying unchanged historic references can save but not accept.
 f2=pg_temp.revise(fr.id);
 BEGIN
  PERFORM pg_temp.accept_revision(f2);
  RAISE EXCEPTION 'TEST FAILED: stale FR accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS stale reference blocks acceptance'; END;
 rid=pg_temp.revise(fr.id,'{}',ARRAY[r2]);
 PERFORM pg_temp.accept_revision(rid);
 BEGIN
  PERFORM pg_temp.accept_revision(alloc.head_revision_id);
  RAISE EXCEPTION 'TEST FAILED: stale FR allocation accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS stale FR blocks allocation acceptance'; END;
 r3=pg_temp.revise(alloc.id,jsonb_build_object('fr_revision_id',rid));
 PERFORM pg_temp.accept_revision(r3);
 -- A later scheme release does not make a valid pinned allocation unacceptable.
 rid=pg_temp.revise(alloc.id);
 SELECT current_version_id INTO prior_scheme FROM ee.project_subsystem_designs WHERE project_id=alloc.project_id;
 scheme=gen_random_uuid();
 INSERT INTO ee.subsystem_design_versions(id,project_id,version_no,parent_version_id,created_by)
 SELECT scheme,project_id,version_no+1,id,created_by FROM ee.subsystem_design_versions WHERE id=prior_scheme;
 INSERT INTO ee.subsystem_version_items(project_id,design_version_id,subsystem_id,name,description,domain_group,sort_order,is_allocatable,source_metadata)
 SELECT project_id,scheme,subsystem_id,name,description,domain_group,sort_order,is_allocatable,source_metadata FROM ee.subsystem_version_items WHERE design_version_id=prior_scheme;
 UPDATE ee.project_subsystem_designs SET current_version_id=scheme WHERE project_id=alloc.project_id;
 PERFORM pg_temp.accept_revision(rid);
 PERFORM pg_temp.assert_ok((SELECT design_version_id FROM ee.allocation_versions WHERE revision_id=rid)=prior_scheme,'pinned valid scheme need not be latest at acceptance');
 -- Create a new accepted PRD. The UC/FR/alloc chain is not recursively invalidated.
 p2=pg_temp.revise(prd.id,jsonb_build_object('markdown_body','新PRD正文'));
 PERFORM pg_temp.accept_revision(p2);
 PERFORM pg_temp.assert_ok(ee.acceptance_issues(r3)='[]','only direct upstream is checked');
 BEGIN
  PERFORM pg_temp.accept_revision(pg_temp.revise(uc.id));
  RAISE EXCEPTION 'TEST FAILED: stale PRD UC accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS stale PRD blocks UC acceptance'; END;
 -- Declarative acceptance rule consumption, using a new definition in this rolled-back test only.
 SELECT type_version_id INTO old FROM ee.artifact_revisions WHERE id=r2;
 typ=gen_random_uuid();
 INSERT INTO ee.artifact_type_versions(id,type_code,version_no,content_schema,field_catalog,metadata_schema,created_by)
 SELECT typ,type_code,999,content_schema,
  (SELECT jsonb_agg(CASE WHEN value->>'key'='preconditions' THEN jsonb_set(value,'{validation}','{"accept_nonblank":true}') ELSE value END ORDER BY ord) FROM jsonb_array_elements(field_catalog) WITH ORDINALITY x(value,ord)),metadata_schema,created_by
 FROM ee.artifact_type_versions WHERE id=old;
 rid=pg_temp.revise(uc.id,jsonb_build_object('prd_revision_id',p2),NULL,NULL,typ,false);
 PERFORM pg_temp.assert_ok(ee.acceptance_issues(rid)::text LIKE '%preconditions%','acceptance consumes bound metadata, not hardcoded required fields');
 PERFORM pg_temp.assert_ok(NOT (ee.acceptance_issues(r2)::text LIKE '%preconditions%'),'new metadata does not reinterpret old revision');
 -- Metadata and content history are append-only.
 BEGIN
  UPDATE ee.artifact_type_versions SET field_catalog='[]' WHERE id=old;
  RAISE EXCEPTION 'TEST FAILED: metadata history changed';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS metadata history immutable'; END;
 BEGIN
  UPDATE ee.artifacts SET accepted_revision_id=uc.head_revision_id WHERE id=uc.id;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: accepted pointer moved backwards';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS accepted pointer cannot point to older accept'; END;
 SET CONSTRAINTS ALL DEFERRED;
 BEGIN
  UPDATE ee.artifacts SET accepted_revision_id=NULL WHERE id=uc.id;
  RAISE EXCEPTION 'TEST FAILED: withdrawal enabled';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS unapproved withdrawal remains blocked'; END;
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
