-- Shared read-only target guard. Required psql variables must be supplied explicitly.
-- Included only after BEGIN by inspect/apply/verify/bind entrypoints.
SELECT set_config('ee.expected_database', :'expected_database', true),
       set_config('ee.expected_system_id', :'expected_system_id', true);
DO $target$
BEGIN
 IF current_database() <> current_setting('ee.expected_database') THEN
  RAISE EXCEPTION 'Wrong database; stop without changes';
 END IF;
 IF (SELECT system_identifier::text FROM pg_control_system()) <> current_setting('ee.expected_system_id') THEN
  RAISE EXCEPTION 'Wrong PostgreSQL cluster; stop without changes';
 END IF;
 IF current_setting('server_version_num')::integer / 10000 <> 18 THEN
  RAISE EXCEPTION 'This reviewed package requires PostgreSQL 18';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
  RAISE EXCEPTION 'Reviewed DBA session required; never run as an API login';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ee_admin.schema_migrations
  WHERE version='001_m0_metadata_r2_20260921' AND sha256='0922b4823e3d557fbe0537034c194546c83288df4230746e50b6c1205ef36390') THEN
  RAISE EXCEPTION 'Reviewed R2 schema migration fingerprint missing or changed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_namespace n ON n.nspowner=r.oid
  WHERE r.rolname='ee_m0_owner' AND n.nspname='ee' AND NOT r.rolcanlogin
   AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
   AND NOT r.rolreplication AND NOT r.rolbypassrls) THEN
  RAISE EXCEPTION 'Safe ee_m0_owner and ee schema ownership required';
 END IF;
END $target$;
