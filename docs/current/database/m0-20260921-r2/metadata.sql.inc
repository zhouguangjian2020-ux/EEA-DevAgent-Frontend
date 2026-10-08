-- R2 fixed type adapters. JSON annotations are data, never executable scripts.
CREATE FUNCTION ee.controlled_import() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,ee AS $$
 SELECT coalesce(current_setting('ee.controlled_import',true),'')='on'
    AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
$$;

CREATE FUNCTION ee.nonblank(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(length(translate(value,E' \t\n\r\f'||chr(11)||chr(133)||chr(160)||chr(5760)||
 chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||
 chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),''))>0,false)
$$;

CREATE FUNCTION ee.fr_source_document(rid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,ee AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('artifact_id',uc_id,'revision_id',uc_revision_id,'rationale',rationale) ORDER BY uc_id),'[]'::jsonb)
 FROM ee.fr_uc_sources WHERE fr_revision_id=rid
$$;

CREATE FUNCTION ee.revision_document(rid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,ee AS $$
DECLARE r ee.artifact_revisions; code_text text; result jsonb; uv ee.uc_versions; av ee.allocation_versions;
BEGIN
 SELECT * INTO STRICT r FROM ee.artifact_revisions WHERE id=rid;
 SELECT code INTO code_text FROM ee.artifacts WHERE id=r.artifact_id;
 CASE r.type_code
 WHEN 'PRD' THEN SELECT jsonb_build_object('code',code_text,'markdown_body',markdown_body) INTO result FROM ee.prd_versions WHERE revision_id=rid;
 WHEN 'UC' THEN
  SELECT * INTO STRICT uv FROM ee.uc_versions WHERE revision_id=rid;
  result=(to_jsonb(uv)-ARRAY['revision_id','project_id','function_id','uc_id','prd_id','prd_revision_id','type_code','main_flow'])
   || jsonb_build_object('code',code_text,'prd_source',jsonb_build_object('artifact_id',uv.prd_id,'revision_id',uv.prd_revision_id),
     'scenario',jsonb_build_object('main_flow',uv.main_flow,
      'branches',(SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'category',category,'position',position,'body',body) ORDER BY category,position,item_id),'[]'::jsonb) FROM ee.uc_scenario_items WHERE uc_revision_id=rid AND kind='branch'),
      'exceptions',(SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'category',category,'position',position,'body',body) ORDER BY category,position,item_id),'[]'::jsonb) FROM ee.uc_scenario_items WHERE uc_revision_id=rid AND kind='exception')));
 WHEN 'FR' THEN SELECT jsonb_build_object('code',code_text,'description',description,'uc_sources',ee.fr_source_document(rid)) INTO result FROM ee.fr_versions WHERE revision_id=rid;
 WHEN 'FR_ALLOCATION' THEN
  SELECT * INTO STRICT av FROM ee.allocation_versions WHERE revision_id=rid;
  SELECT jsonb_build_object('fr_code',a.code,'description',f.description,'uc_sources',ee.fr_source_document(av.fr_revision_id),
    'fr_source',jsonb_build_object('artifact_id',av.fr_id,'revision_id',av.fr_revision_id),'scheme_version_id',av.design_version_id,'note',av.note,
    'subsystem_ids',(SELECT coalesce(jsonb_agg(subsystem_id ORDER BY subsystem_id),'[]'::jsonb) FROM ee.allocation_targets WHERE allocation_revision_id=rid))
   INTO result FROM ee.fr_versions f JOIN ee.artifacts a ON a.id=f.fr_id WHERE f.revision_id=av.fr_revision_id;
 ELSE RAISE EXCEPTION 'unsupported type' USING ERRCODE='23514';
 END CASE;
 RETURN result;
END $$;

CREATE FUNCTION ee.direct_upstreams(rid uuid) RETURNS TABLE(artifact_id uuid,revision_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,ee AS $$
 SELECT prd_id,prd_revision_id FROM ee.uc_versions WHERE revision_id=rid
 UNION ALL SELECT uc_id,uc_revision_id FROM ee.fr_uc_sources WHERE fr_revision_id=rid
 UNION ALL SELECT fr_id,fr_revision_id FROM ee.allocation_versions WHERE revision_id=rid
$$;

CREATE FUNCTION ee.acceptance_issues(rid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,ee AS $$
DECLARE catalog jsonb; doc jsonb; f jsonb; path text[]; value jsonb; issues jsonb:='[]'; dep record;
BEGIN
 SELECT t.field_catalog INTO STRICT catalog FROM ee.artifact_revisions r JOIN ee.artifact_type_versions t ON t.id=r.type_version_id WHERE r.id=rid;
 doc=ee.revision_document(rid);
 -- Only two reviewed declarative validators. No expression engine or dynamic SQL paths.
 FOR f IN SELECT p.value FROM jsonb_array_elements(catalog) p(value)
   UNION ALL SELECT c.value FROM jsonb_array_elements(catalog) p(value) CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.value->'children','[]')) c(value)
 LOOP
  SELECT array_agg(v ORDER BY n) INTO path FROM jsonb_array_elements_text(f->'path_segments') WITH ORDINALITY x(v,n);
  value=doc#>path;
  IF coalesce((f#>>'{validation,accept_nonblank}')::boolean,false) AND NOT ee.nonblank(doc#>>path) THEN
   issues=issues||jsonb_build_array(jsonb_build_object('code','required_content','path',path,'label',f->>'label'));
  END IF;
  IF f->'validation' ? 'accept_min_items' THEN
   IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)<(f#>>'{validation,accept_min_items}')::integer THEN
    issues=issues||jsonb_build_array(jsonb_build_object('code','minimum_items','path',path,'label',f->>'label'));
   END IF;
  END IF;
 END LOOP;
 FOR dep IN SELECT u.*,a.accepted_revision_id FROM ee.direct_upstreams(rid) u JOIN ee.artifacts a ON a.id=u.artifact_id LOOP
  IF dep.revision_id IS DISTINCT FROM dep.accepted_revision_id THEN
   issues=issues||jsonb_build_array(jsonb_build_object('code','upstream_not_current_accepted','artifact_id',dep.artifact_id,'referenced_revision_id',dep.revision_id,'current_accepted_revision_id',dep.accepted_revision_id));
  END IF;
 END LOOP;
 RETURN issues;
END $$;

CREATE FUNCTION ee.revision_state(rid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,ee AS $$
 SELECT jsonb_build_object('artifact_id',a.id,'revision_id',r.id,'head_revision_id',a.head_revision_id,
  'accepted_revision_id',a.accepted_revision_id,'lock_version',a.lock_version::text,
  'review_status',coalesce((SELECT CASE decision WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' ELSE 'pending' END FROM ee.review_events WHERE revision_id=rid ORDER BY event_no DESC LIMIT 1),'pending'),
  'is_head',rid=a.head_revision_id,'is_current_accepted',rid IS NOT DISTINCT FROM a.accepted_revision_id,
  'dependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('artifact_id',u.artifact_id,'referenced_revision_id',u.revision_id,
   'current_accepted_revision_id',p.accepted_revision_id,'changed',u.revision_id IS DISTINCT FROM p.accepted_revision_id,
   'has_unaccepted_working_revision',p.head_revision_id IS DISTINCT FROM p.accepted_revision_id) ORDER BY u.artifact_id),'[]'::jsonb)
   FROM ee.direct_upstreams(rid) u JOIN ee.artifacts p ON p.id=u.artifact_id))
 FROM ee.artifact_revisions r JOIN ee.artifacts a ON a.id=r.artifact_id WHERE r.id=rid
$$;

CREATE FUNCTION ee.guard_revision_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,ee AS $$
DECLARE a ee.artifacts; last_no bigint; expected_base uuid; base_type uuid;
BEGIN
 SELECT * INTO STRICT a FROM ee.artifacts WHERE id=NEW.artifact_id FOR UPDATE;
 SELECT max(revision_no) INTO last_no FROM ee.artifact_revisions WHERE artifact_id=a.id;
 expected_base=CASE WHEN last_no IS NULL THEN NULL ELSE a.head_revision_id END;
 IF NEW.revision_no<>coalesce(last_no,0)+1 OR NEW.base_revision_id IS DISTINCT FROM expected_base THEN
  RAISE EXCEPTION 'stale base or revision sequence; reload current head, do not overwrite' USING ERRCODE='23514';
 END IF;
 IF NEW.created_via IN ('import','migration') AND NOT ee.controlled_import() THEN
  RAISE EXCEPTION 'import/migration requires explicit controlled DBA session' USING ERRCODE='42501';
 END IF;
 -- Retired definitions remain readable, and may be retained by an existing revision chain.
 IF EXISTS(SELECT 1 FROM ee.artifact_type_versions WHERE id=NEW.type_version_id AND retired_at IS NOT NULL) THEN
  SELECT type_version_id INTO base_type FROM ee.artifact_revisions WHERE id=expected_base;
  IF base_type IS DISTINCT FROM NEW.type_version_id THEN RAISE EXCEPTION 'cannot newly adopt retired definition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_insert_guard BEFORE INSERT ON ee.artifact_revisions FOR EACH ROW EXECUTE FUNCTION ee.guard_revision_insert();

CREATE FUNCTION ee.guard_fr_source_selection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,ee AS $$
DECLARE base uuid; accepted uuid;
BEGIN
 IF ee.controlled_import() THEN RETURN NEW; END IF;
 SELECT base_revision_id INTO base FROM ee.artifact_revisions WHERE id=NEW.fr_revision_id;
 IF EXISTS(SELECT 1 FROM ee.fr_uc_sources WHERE fr_revision_id=base AND uc_id=NEW.uc_id AND uc_revision_id=NEW.uc_revision_id) THEN
  RETURN NEW; -- unchanged reference carried into a new revision, not a new source selection
 END IF;
 SELECT accepted_revision_id INTO accepted FROM ee.artifacts WHERE id=NEW.uc_id FOR SHARE;
 IF accepted IS NULL OR accepted IS DISTINCT FROM NEW.uc_revision_id THEN
  RAISE EXCEPTION 'new FR source must be current accepted UC revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fr_source_selection_guard BEFORE INSERT ON ee.fr_uc_sources FOR EACH ROW EXECUTE FUNCTION ee.guard_fr_source_selection();
