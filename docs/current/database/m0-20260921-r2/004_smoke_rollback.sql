BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(160921,200);
SET LOCAL ROLE ee_m0_owner;
SET LOCAL search_path=ee,pg_catalog;
DO $tests$
DECLARE p uuid:='10d4c8a0-ff3a-56c3-abf6-18dc3b531e62'::uuid; a ee.artifacts; fr ee.fr_versions; actor uuid; new_rev uuid; typ uuid; t ee.allocation_targets; n integer;
BEGIN
 SELECT created_by INTO actor FROM ee.projects WHERE id=p;
 IF actor IS NULL THEN RAISE EXCEPTION 'Import sample before smoke tests'; END IF;
 -- 1. Already committed version body cannot be rewritten.
 BEGIN
  UPDATE ee.prd_versions SET markdown_body=markdown_body||'changed' WHERE project_id=p;
  RAISE EXCEPTION 'TEST FAILED: immutable body update succeeded';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS immutable version'; END;
 -- 2. No FK can invent/cross-bind a project.
 BEGIN
  INSERT INTO ee.subsystems(id,project_id,code,created_by) VALUES(gen_random_uuid(),gen_random_uuid(),'SMOKE',actor);
  RAISE EXCEPTION 'TEST FAILED: dangling project allowed';
 EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS project FK'; END;
 -- 3. Malformed authorization scope rejected.
 BEGIN
  INSERT INTO ee.access_bindings(id,project_id,user_id,scope_kind,function_id,artifact_id,role_id,created_by,updated_by)
   SELECT gen_random_uuid(),project_id,user_id,'project',gen_random_uuid(),NULL,role_id,created_by,updated_by FROM ee.access_bindings WHERE project_id=p LIMIT 1;
  RAISE EXCEPTION 'TEST FAILED: malformed scope accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS exact scope shape'; END;
 -- 4. New revision without its typed body cannot commit.
 SELECT * INTO a FROM ee.artifacts WHERE project_id=p AND type_code='UC' LIMIT 1;
 SELECT type_version_id INTO typ FROM ee.artifact_revisions WHERE id=a.head_revision_id;
 BEGIN
  INSERT INTO ee.artifact_revisions(id,project_id,function_id,artifact_id,type_code,revision_no,base_revision_id,type_version_id,created_by)
  VALUES(gen_random_uuid(),p,a.function_id,a.id,'UC',2,a.head_revision_id,typ,actor);
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: missing typed body accepted';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS missing typed body'; END;
 SET CONSTRAINTS ALL DEFERRED;
 -- 5. Mixing type and identity rejected (without relying on the body check).
 BEGIN
  INSERT INTO ee.functional_requirements(artifact_id,project_id,function_id) VALUES(a.id,p,a.function_id);
  RAISE EXCEPTION 'TEST FAILED: UC identity used as FR';
 EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS type FK'; END;
 -- 6. Appending sources to a committed FR snapshot is forbidden.
 SELECT * INTO fr FROM ee.fr_versions WHERE project_id=p ORDER BY revision_id LIMIT 1;
 BEGIN
  INSERT INTO ee.fr_uc_sources(project_id,function_id,fr_revision_id,uc_id,uc_revision_id)
  SELECT p,fr.function_id,fr.revision_id,u.uc_id,u.revision_id FROM ee.uc_versions u
  WHERE u.project_id=p AND NOT EXISTS(SELECT 1 FROM ee.fr_uc_sources x WHERE x.fr_revision_id=fr.revision_id AND x.uc_id=u.uc_id) LIMIT 1;
  RAISE EXCEPTION 'TEST FAILED: append to committed FR succeeded';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS immutable relation set'; END;
 -- 7. Accepted pointer cannot be invented without an authorized review.
 BEGIN
  UPDATE ee.artifacts SET accepted_revision_id=head_revision_id WHERE id=a.id;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: fabricated acceptance succeeded';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS accepted/review consistency'; END;
 SET CONSTRAINTS ALL DEFERRED;
 -- 8. A fresh allocation can target two systems without editing FR content.
 SELECT * INTO t FROM ee.allocation_targets WHERE project_id=p LIMIT 1;
 new_rev=gen_random_uuid();
 SELECT id INTO typ FROM ee.artifact_type_versions WHERE type_code='FR_ALLOCATION' ORDER BY version_no DESC LIMIT 1;
 SELECT * INTO a FROM ee.artifacts WHERE id=(SELECT allocation_id FROM ee.allocation_versions WHERE revision_id=t.allocation_revision_id);
 INSERT INTO ee.artifact_revisions(id,project_id,function_id,artifact_id,type_code,revision_no,base_revision_id,type_version_id,created_by)
  VALUES(new_rev,p,a.function_id,a.id,'FR_ALLOCATION',2,a.head_revision_id,typ,actor);
 INSERT INTO ee.allocation_versions(revision_id,project_id,function_id,allocation_id,fr_id,fr_revision_id,design_version_id)
  SELECT new_rev,project_id,function_id,allocation_id,fr_id,fr_revision_id,design_version_id FROM ee.allocation_versions WHERE revision_id=a.head_revision_id;
 INSERT INTO ee.allocation_targets(project_id,function_id,allocation_revision_id,design_version_id,subsystem_id)
  SELECT p,a.function_id,new_rev,t.design_version_id,subsystem_id FROM ee.subsystem_version_items WHERE project_id=p AND design_version_id=t.design_version_id ORDER BY sort_order LIMIT 2;
 UPDATE ee.artifacts SET head_revision_id=new_rev WHERE id=a.id;
 SET CONSTRAINTS ALL IMMEDIATE;
 SELECT count(*) INTO n FROM ee.allocation_targets WHERE allocation_revision_id=new_rev;
 IF n<>2 THEN RAISE EXCEPTION 'TEST FAILED: multi-target relation missing'; END IF;
 RAISE NOTICE 'PASS one FR multiple targets; transaction will roll back';
END $tests$;
ROLLBACK;
