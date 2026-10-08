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
DECLARE r ee.artifact_revisions;
BEGIN
 IF (NEW.id,NEW.project_id,NEW.function_id,NEW.type_code,NEW.code,NEW.created_by,NEW.created_at) IS DISTINCT FROM
    (OLD.id,OLD.project_id,OLD.function_id,OLD.type_code,OLD.code,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'artifact identity cannot move or change' USING ERRCODE='23514';
 END IF;
 IF NEW.head_revision_id IS DISTINCT FROM OLD.head_revision_id THEN
  SELECT * INTO r FROM ee.artifact_revisions WHERE id=NEW.head_revision_id;
  IF NOT FOUND OR r.artifact_id<>NEW.id OR r.base_revision_id IS DISTINCT FROM OLD.head_revision_id THEN
   RAISE EXCEPTION 'head must advance from current base to a new revision' USING ERRCODE='23514';
  END IF;
 END IF;
 IF OLD.accepted_revision_id IS NOT NULL AND NEW.accepted_revision_id IS NULL THEN
  RAISE EXCEPTION 'withdraw is not released; accepted history must remain' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=clock_timestamp();
 NEW.lock_version=OLD.lock_version+1;
 RETURN NEW;
END $$;

CREATE FUNCTION ee.check_revision_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE r ee.artifact_revisions; n integer; head_no bigint;
BEGIN
 SELECT * INTO r FROM ee.artifact_revisions WHERE id=NEW.id;
 SELECT (SELECT count(*) FROM ee.prd_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.uc_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.fr_versions WHERE revision_id=r.id)
       +(SELECT count(*) FROM ee.allocation_versions WHERE revision_id=r.id) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'revision % needs exactly one typed body, got %',r.id,n USING ERRCODE='23514'; END IF;
 SELECT h.revision_no INTO head_no FROM ee.artifacts a JOIN ee.artifact_revisions h ON h.id=a.head_revision_id WHERE a.id=r.artifact_id;
 IF head_no IS NULL OR head_no<r.revision_no THEN RAISE EXCEPTION 'new revision must advance working head in same transaction' USING ERRCODE='23514'; END IF;
 -- D05: zero FR sources and zero allocation targets are legal drafts, never automatically accepted.
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER revision_complete AFTER INSERT ON ee.artifact_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ee.check_revision_complete();

CREATE FUNCTION ee.check_artifact_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE a ee.artifacts; n integer; last_accepted uuid;
BEGIN
 SELECT * INTO a FROM ee.artifacts WHERE id=NEW.id;
 SELECT (SELECT count(*) FROM ee.prds WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.use_cases WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.functional_requirements WHERE artifact_id=a.id)
       +(SELECT count(*) FROM ee.fr_allocations WHERE artifact_id=a.id) INTO n;
 IF n<>1 OR a.head_revision_id IS NULL THEN RAISE EXCEPTION 'artifact needs one typed identity and working revision' USING ERRCODE='23514'; END IF;
 SELECT revision_id INTO last_accepted FROM ee.review_events WHERE artifact_id=a.id AND decision='accept' ORDER BY event_no DESC LIMIT 1;
 IF a.accepted_revision_id IS DISTINCT FROM last_accepted THEN
  RAISE EXCEPTION 'accepted pointer must match most recent accept, not most recent unrelated review' USING ERRCODE='23514';
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
DECLARE parent_xmin text; parent_id uuid; top_xid numeric; full_xid numeric;
BEGIN
 parent_id=(to_jsonb(NEW)->>TG_ARGV[1])::uuid;
 EXECUTE format('SELECT xmin::text FROM ee.%I WHERE %I=$1',TG_ARGV[0],TG_ARGV[2]) INTO parent_xmin USING parent_id;
 IF parent_xmin IS NULL THEN RAISE EXCEPTION 'snapshot parent absent' USING ERRCODE='23514'; END IF;
 -- xmin may be a subtransaction, not the top xid. A visible in-progress tuple can
 -- only be ours: other transactions' uncommitted tuples are invisible under MVCC.
 -- Lift the 32-bit xmin into the nearest xid8 epoch (PostgreSQL wraparound ordering).
 top_xid=pg_current_xact_id()::text::numeric;
 full_xid=top_xid-mod(top_xid,4294967296)+parent_xmin::numeric;
 IF full_xid-top_xid>2147483647 THEN full_xid=full_xid-4294967296;
 ELSIF top_xid-full_xid>2147483648 THEN full_xid=full_xid+4294967296; END IF;
 IF full_xid<3 OR pg_xact_status(full_xid::text::xid8) IS DISTINCT FROM 'in progress' THEN
  RAISE EXCEPTION 'cannot append content to an already committed snapshot: %',parent_id USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION ee.check_review() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE a ee.artifacts; allowed boolean; issues jsonb;
BEGIN
 SELECT * INTO STRICT a FROM ee.artifacts WHERE id=NEW.artifact_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM ee.app_users u
  JOIN ee.project_members m ON m.user_id=u.id AND m.project_id=NEW.project_id
  JOIN ee.access_bindings b ON b.project_id=m.project_id AND b.user_id=u.id AND b.scope_kind='project'
  JOIN ee.access_roles ar ON ar.id=b.role_id AND ar.enabled
  JOIN ee.role_permissions rp ON rp.role_id=ar.id
  JOIN ee.permission_definitions pd ON pd.code=rp.permission_code AND pd.enabled
  WHERE u.id=NEW.actor_id AND u.state='active' AND m.state='active'
    AND pd.resource_kind=a.type_code AND pd.action='accept' AND 'project'=ANY(pd.allowed_scopes)
  FOR SHARE OF u,m,b,ar,rp,pd) INTO allowed;
 IF NOT allowed THEN RAISE EXCEPTION 'no project review permission' USING ERRCODE='42501'; END IF;
 IF NEW.decision='withdraw' THEN RAISE EXCEPTION 'withdraw awaits separate policy' USING ERRCODE='23514'; END IF;
 IF NEW.event_no<>(SELECT coalesce(max(event_no),0)+1 FROM ee.review_events WHERE artifact_id=NEW.artifact_id) THEN
  RAISE EXCEPTION 'review event sequence conflict' USING ERRCODE='23514';
 END IF;
 IF NEW.revision_id IS DISTINCT FROM a.head_revision_id THEN RAISE EXCEPTION 'review targets current head only' USING ERRCODE='23514'; END IF;
 IF NEW.revision_id IS NOT DISTINCT FROM a.accepted_revision_id THEN RAISE EXCEPTION 'already accepted revision cannot be re-reviewed' USING ERRCODE='23514'; END IF;
 IF NEW.decision='accept' THEN
  -- Share locks serialize acceptance against direct upstream pointer updates. No recursive locks.
  PERFORM 1 FROM ee.artifacts p WHERE p.id IN (SELECT artifact_id FROM ee.direct_upstreams(NEW.revision_id)) ORDER BY p.id FOR SHARE;
  issues=ee.acceptance_issues(NEW.revision_id);
  IF jsonb_array_length(issues)>0 THEN RAISE EXCEPTION 'acceptance blocked: %',issues USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_permission_guard BEFORE INSERT ON ee.review_events FOR EACH ROW EXECUTE FUNCTION ee.check_review();
CREATE FUNCTION ee.check_review_pointer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, ee AS $$
DECLARE last_accepted uuid; pointer uuid;
BEGIN
 SELECT revision_id INTO last_accepted FROM ee.review_events WHERE artifact_id=NEW.artifact_id AND decision='accept' ORDER BY event_no DESC LIMIT 1;
 SELECT accepted_revision_id INTO pointer FROM ee.artifacts WHERE id=NEW.artifact_id;
 IF pointer IS DISTINCT FROM last_accepted THEN
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
