DO $verify$
DECLARE
 r record; t record; priv text; allowed boolean;
 reads text[] := ARRAY['projects','app_users','project_members','access_bindings','access_roles','role_permissions','permission_definitions','project_subsystem_designs'];
 inserts text[] := ARRAY['projects','project_members','access_bindings','project_subsystem_designs','security_audit_events'];
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_create';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
  RAISE EXCEPTION 'Creator role missing or unsafe';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN RAISE EXCEPTION 'Creator role memberships found'; END IF;
 IF has_database_privilege(r.oid,current_database(),'CREATE') OR EXISTS(
  SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(r.oid,n.oid,'CREATE')
 ) THEN RAISE EXCEPTION 'Creator must not have CREATE privileges'; END IF;
 IF NOT has_database_privilege(r.oid,current_database(),'CONNECT') OR NOT has_schema_privilege(r.oid,'ee','USAGE') THEN
  RAISE EXCEPTION 'Creator lacks CONNECT/USAGE';
 END IF;
 FOR t IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') LOOP
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   allowed := t.nspname='ee' AND ((priv='SELECT' AND t.relname=ANY(reads)) OR (priv='INSERT' AND t.relname=ANY(inserts)));
   IF has_table_privilege(r.oid,t.oid,priv) IS DISTINCT FROM allowed THEN
    RAISE EXCEPTION 'Unexpected or missing creator privilege: %.% %',t.nspname,t.relname,priv;
   END IF;
   IF NOT allowed AND priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r.oid,t.oid,priv) THEN
    RAISE EXCEPTION 'Unexpected creator column privilege: %.% %',t.nspname,t.relname,priv;
   END IF;
  END LOOP;
 END LOOP;
 IF NOT (r.rolconfig @> ARRAY['default_transaction_read_only=off','statement_timeout=5s','lock_timeout=2s','idle_in_transaction_session_timeout=15s']) THEN
  RAISE EXCEPTION 'Creator defaults differ from reviewed limits';
 END IF;
 RAISE NOTICE 'CREATOR GRANTS: PASS; 8 SELECT tables; 5 INSERT tables; no UPDATE/DELETE/DDL/elevated attributes';
END $verify$;
