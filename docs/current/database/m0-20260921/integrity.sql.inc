-- First phase is a controlled DBA import, not an application authorization layer.
-- No API credentials are granted ownership or direct business-table access.
CREATE FUNCTION ee.reject_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
BEGIN
  RAISE EXCEPTION 'history/identity is immutable: %.%', TG_TABLE_SCHEMA,TG_TABLE_NAME USING ERRCODE='23514';
END $$;

CREATE FUNCTION ee.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END $$;

CREATE FUNCTION ee.guard_type_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'type history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'retired_at') IS DISTINCT FROM (to_jsonb(OLD)-'retired_at') THEN
   RAISE EXCEPTION 'only retired_at may change on a type version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION ee.guard_artifact_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
BEGIN
 IF (NEW.id,NEW.project_id,NEW.function_id,NEW.type_code,NEW.code) IS DISTINCT FROM
    (OLD.id,OLD.project_id,OLD.function_id,OLD.type_code,OLD.code) THEN
    RAISE EXCEPTION 'artifact identity cannot move or change type/code' USING ERRCODE='23514';
 END IF;
 IF OLD.accepted_revision_id IS NOT NULL AND
    (NEW.head_revision_id,NEW.accepted_revision_id) IS DISTINCT FROM
    (OLD.head_revision_id,OLD.accepted_revision_id) THEN
    RAISE EXCEPTION 'accepted revision rewrite/withdraw awaits confirmed policy' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=clock_timestamp();
 NEW.lock_version=OLD.lock_version+1;
 RETURN NEW;
END $$;

CREATE FUNCTION ee.check_revision_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE r ee.artifact_revisions; n integer; parent_no bigint;
BEGIN
 SELECT * INTO r FROM ee.artifact_revisions WHERE id=NEW.id;
 SELECT (SELECT count(*) FROM ee.prd_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.uc_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.fr_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.allocation_versions WHERE revision_id=r.id) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'revision % needs exactly one typed body, got %',r.id,n USING ERRCODE='23514'; END IF;
 IF r.base_revision_id IS NOT NULL THEN
  SELECT revision_no INTO parent_no FROM ee.artifact_revisions WHERE id=r.base_revision_id;
  IF parent_no>=r.revision_no THEN RAISE EXCEPTION 'revision parent must be older' USING ERRCODE='23514'; END IF;
 END IF;
 IF r.type_code='FR' AND NOT EXISTS(SELECT 1 FROM ee.fr_uc_sources WHERE fr_revision_id=r.id) THEN
  RAISE EXCEPTION 'FR requires explicit UC source(s)' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER revision_complete AFTER INSERT ON ee.artifact_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_revision_complete();

CREATE FUNCTION ee.check_artifact_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE a ee.artifacts; n integer; accepted boolean;
BEGIN
 SELECT * INTO a FROM ee.artifacts WHERE id=NEW.id;
 SELECT (SELECT count(*) FROM ee.prds WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.use_cases WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.functional_requirements WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.fr_allocations WHERE artifact_id=a.id) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'artifact % needs exactly one typed identity',a.id USING ERRCODE='23514'; END IF;
 IF a.accepted_revision_id IS NOT NULL THEN
  SELECT decision='accept' AND revision_id=a.accepted_revision_id INTO accepted
    FROM ee.review_events WHERE artifact_id=a.id ORDER BY event_no DESC LIMIT 1;
  IF accepted IS DISTINCT FROM true THEN RAISE EXCEPTION 'accepted pointer has no matching last review' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER artifact_complete AFTER INSERT OR UPDATE ON ee.artifacts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_artifact_complete();

CREATE FUNCTION ee.check_scheme_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE parent_no integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM ee.subsystem_version_items WHERE project_id=NEW.project_id AND design_version_id=NEW.id) THEN
   RAISE EXCEPTION 'scheme requires complete nonempty directory' USING ERRCODE='23514';
 END IF;
 IF NEW.parent_version_id IS NOT NULL THEN
  SELECT version_no INTO parent_no FROM ee.subsystem_design_versions WHERE id=NEW.parent_version_id;
  IF parent_no>=NEW.version_no THEN RAISE EXCEPTION 'scheme parent must be older' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER scheme_complete AFTER INSERT ON ee.subsystem_design_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_scheme_complete();

CREATE FUNCTION ee.check_allocatable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE ok boolean;
BEGIN
 SELECT is_allocatable INTO ok FROM ee.subsystem_version_items
 WHERE project_id=NEW.project_id AND design_version_id=NEW.design_version_id AND subsystem_id=NEW.subsystem_id;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'target absent or not allocatable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_target_guard BEFORE INSERT ON ee.allocation_targets FOR EACH ROW EXECUTE FUNCTION ee.check_allocatable();

CREATE FUNCTION ee.check_current_allocation_scheme() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE current_scheme uuid;
BEGIN
 SELECT current_version_id INTO current_scheme FROM ee.project_subsystem_designs WHERE project_id=NEW.project_id;
 IF current_scheme IS DISTINCT FROM NEW.design_version_id THEN
  RAISE EXCEPTION 'new allocation must use current project scheme' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER allocation_current_scheme AFTER INSERT ON ee.allocation_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_current_allocation_scheme();

-- For an immutable snapshot, dependent content can only be attached in its creating transaction.
CREATE FUNCTION ee.guard_snapshot_append() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE parent_xmin text; parent_id uuid; current_xid bigint;
BEGIN
 parent_id=(to_jsonb(NEW)->>TG_ARGV[1])::uuid;
 EXECUTE format('SELECT xmin::text FROM ee.%I WHERE %I=$1',TG_ARGV[0],TG_ARGV[2]) INTO parent_xmin USING parent_id;
 current_xid=pg_current_xact_id()::text::bigint % 4294967296;
 IF parent_xmin IS NULL OR parent_xmin::bigint<>current_xid THEN
   RAISE EXCEPTION 'cannot append content to an already committed snapshot: %',parent_id USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION ee.check_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE a ee.artifacts; allowed boolean;
BEGIN
 SELECT * INTO a FROM ee.artifacts WHERE id=NEW.artifact_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM ee.app_users u
  JOIN ee.project_members m ON m.user_id=u.id AND m.project_id=NEW.project_id
  JOIN ee.access_bindings b ON b.project_id=m.project_id AND b.user_id=u.id AND b.scope_kind='project'
  JOIN ee.access_roles ar ON ar.id=b.role_id AND ar.enabled
  JOIN ee.role_permissions rp ON rp.role_id=ar.id
  JOIN ee.permission_definitions pd ON pd.code=rp.permission_code AND pd.enabled
  WHERE u.id=NEW.actor_id AND u.state='active' AND m.state='active'
    AND pd.resource_kind=a.type_code AND pd.action='accept' AND 'project'=ANY(pd.allowed_scopes)) INTO allowed;
 IF NOT allowed THEN RAISE EXCEPTION 'no project review permission' USING ERRCODE='42501'; END IF;
 IF a.accepted_revision_id IS NOT NULL OR NEW.decision='withdraw' THEN
  RAISE EXCEPTION 'accepted rewrite/withdraw awaits confirmed policy' USING ERRCODE='23514';
 END IF;
 IF NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=NEW.artifact_id) THEN
  RAISE EXCEPTION 'review event sequence conflict' USING ERRCODE='23514';
 END IF;
 IF NEW.decision='accept' THEN
  IF NEW.revision_id IS DISTINCT FROM a.head_revision_id THEN RAISE EXCEPTION 'only head can be accepted' USING ERRCODE='23514'; END IF;
  IF a.type_code='UC' THEN
   IF (SELECT count(*) FROM ee.uc_scenario_items WHERE uc_revision_id=NEW.revision_id AND kind='branch')<>4
      OR (SELECT count(*) FROM ee.uc_scenario_items WHERE uc_revision_id=NEW.revision_id AND kind='exception')<>5 THEN
    RAISE EXCEPTION 'UC acceptance needs 4 branches and 5 exception categories' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_permission_guard BEFORE INSERT ON ee.review_events FOR EACH ROW EXECUTE FUNCTION ee.check_review();
CREATE FUNCTION ee.check_review_pointer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
BEGIN
 IF NEW.decision='accept' AND (SELECT accepted_revision_id FROM ee.artifacts WHERE id=NEW.artifact_id) IS DISTINCT FROM NEW.revision_id THEN
  RAISE EXCEPTION 'accept review and pointer must commit together' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_pointer AFTER INSERT ON ee.review_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_review_pointer();

CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.artifact_revisions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.prd_versions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.uc_versions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.uc_scenario_items FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.fr_versions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.fr_uc_sources FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.subsystem_design_versions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.subsystem_version_items FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.allocation_versions FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.allocation_targets FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.review_events FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.security_audit_events FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.prds FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.use_cases FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.functional_requirements FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.fr_allocations FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER history_guard BEFORE UPDATE OR DELETE ON ee.subsystems FOR EACH ROW EXECUTE FUNCTION ee.reject_history_change();
CREATE TRIGGER type_history_guard BEFORE UPDATE OR DELETE ON ee.artifact_type_versions FOR EACH ROW EXECUTE FUNCTION ee.guard_type_definition();
CREATE TRIGGER artifact_identity_guard BEFORE UPDATE ON ee.artifacts FOR EACH ROW EXECUTE FUNCTION ee.guard_artifact_update();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.projects FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.business_functions FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.app_users FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.project_members FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.artifact_types FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.project_subsystem_designs FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.access_roles FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.access_bindings FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER updated_at_guard BEFORE UPDATE ON ee.permission_definitions FOR EACH ROW EXECUTE FUNCTION ee.touch_updated_at();
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.prd_versions FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.uc_versions FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.fr_versions FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.allocation_versions FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.uc_scenario_items FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','uc_revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.fr_uc_sources FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','fr_revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.allocation_targets FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('artifact_revisions','allocation_revision_id','id');
CREATE TRIGGER snapshot_append_guard BEFORE INSERT ON ee.subsystem_version_items FOR EACH ROW EXECUTE FUNCTION ee.guard_snapshot_append('subsystem_design_versions','design_version_id','id');
