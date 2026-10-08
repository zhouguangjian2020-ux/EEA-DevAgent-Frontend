"""Compile read-only content verification and rollback-only constraint checks."""
import json
from pathlib import Path
from compile_seed import literal
BASE=Path(__file__).resolve().parent
package=json.loads((BASE/'data/seed-data.json').read_text(encoding='utf-8'))
dictionary=json.loads((BASE/'schema-manifest.json').read_text(encoding='utf-8'))
spec={t['name']:{'pk':t['pk']} for t in dictionary['tables'] if t['phase']=='M0 CRUD'}
pid=package['project_id']
sql="""-- Read-only exact row/column comparison; raises on mismatch, not count-only verification.
DO $verify$
DECLARE payload jsonb:=__PAYLOAD__::jsonb; spec jsonb:=__SPEC__::jsonb; actor uuid; tab text; r jsonb; actual jsonb; pk_join text; k text; actual_count bigint;
BEGIN
 SELECT id INTO actor FROM ee.app_users WHERE external_subject=current_setting('ee.import_subject') AND state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'Expected real importer identity not found'; END IF;
 FOR tab IN SELECT jsonb_object_keys(payload->'data') LOOP
  IF payload->'data'->tab->0 ? 'project_id' THEN
   EXECUTE format('SELECT count(*) FROM ee.%I WHERE project_id=$1',tab) INTO actual_count USING (payload->>'project_id')::uuid;
   IF actual_count<>jsonb_array_length(payload->'data'->tab) THEN RAISE EXCEPTION 'Unexpected sample row count in %',tab; END IF;
  END IF;
  SELECT string_agg(format('t.%I = r.%I',value,value),' AND ') INTO pk_join FROM jsonb_array_elements_text(spec->tab->'pk');
  FOR r IN SELECT value FROM jsonb_array_elements(payload->'data'->tab) LOOP
   r=replace(r::text,'"__IMPORT_USER__"',to_jsonb(actor)::text)::jsonb;
   EXECUTE format('SELECT to_jsonb(t) FROM ee.%I t JOIN jsonb_populate_record(NULL::ee.%I,$1) r ON %s',tab,tab,pk_join) INTO actual USING r;
   IF actual IS NULL THEN RAISE EXCEPTION 'Missing expected row in %',tab; END IF;
   FOR k IN SELECT jsonb_object_keys(r) LOOP
    IF actual->k IS DISTINCT FROM r->k THEN RAISE EXCEPTION 'Content mismatch %.%',tab,k; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS (SELECT 1 FROM ee.artifacts WHERE project_id=__PID__::uuid AND accepted_revision_id IS NOT NULL) THEN RAISE EXCEPTION 'Imported sample unexpectedly accepted'; END IF;
 IF EXISTS (SELECT 1 FROM ee.review_events WHERE project_id=__PID__::uuid) THEN RAISE EXCEPTION 'Unexpected review history'; END IF;
 IF EXISTS (SELECT 1 FROM ee.allocation_targets a LEFT JOIN ee.subsystem_version_items s USING(project_id,design_version_id,subsystem_id) WHERE a.project_id=__PID__::uuid AND (s.subsystem_id IS NULL OR NOT s.is_allocatable)) THEN RAISE EXCEPTION 'Invalid target'; END IF;
 RAISE NOTICE 'All expected source fields, numbered text, mappings and identities match; no fabricated acceptance.';
END $verify$;
SELECT type_code,count(*) AS sample_objects FROM ee.artifacts WHERE project_id=__PID__::uuid GROUP BY type_code ORDER BY type_code;
SELECT s.domain_group,s.name,count(t.subsystem_id) AS allocated_fr_count FROM ee.subsystem_version_items s LEFT JOIN ee.allocation_targets t USING(project_id,design_version_id,subsystem_id) WHERE s.project_id=__PID__::uuid GROUP BY s.domain_group,s.name,s.sort_order ORDER BY s.sort_order;
""".replace('__PAYLOAD__',literal(json.dumps(package,ensure_ascii=False,separators=(',',':')))).replace('__SPEC__',literal(json.dumps(spec))).replace('__PID__',literal(pid))
(BASE/'003_verify.sql').write_text(sql,encoding='utf-8')
# All expected-error blocks deliberately roll back their own subtransactions.
smoke="""BEGIN;
SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(160921,200);
SET LOCAL ROLE ee_m0_owner;
SET LOCAL search_path=ee,pg_catalog;
DO $tests$
DECLARE p uuid:=__PID__::uuid; a ee.artifacts; fr ee.fr_versions; actor uuid; new_rev uuid; typ uuid; t ee.allocation_targets; n integer;
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
""".replace('__PID__',literal(pid))
(BASE/'004_smoke_rollback.sql').write_text(smoke,encoding='utf-8')
print('Compiled exact verification and rollback-only smoke SQL')
