(
  set -Eeuo pipefail
  trap 'echo "DB_INSPECTION_FAILED: do not migrate or switch services" >&2' ERR
  test "$(uname -s)" = 'Linux'

  echo '=== four new image IDs ==='
  for image in \
    'ts-agent-backend:20261003-workflows-r2' \
    'ts-agent-frontend:20261003-workflows-r2' \
    'ts-agent-backend:agent-console-20261003-workflows-r2' \
    'ts-agent-console:20261003-workflows-r2'; do
    id=$(docker image inspect --format '{{.Id}}' "$image")
    printf '%s %s\n' "$image" "$id"
    if [ "$image" = 'ts-agent-backend:20261003-workflows-r2' ]; then
      test "$id" = 'sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
    fi
  done

  echo '=== database readonly inspection ==='
  test -x /usr/lib/postgresql/18/bin/psql
  sudo -v
  sudo -n -u postgres env \
    PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000' \
    /usr/lib/postgresql/18/bin/psql \
    -X -w -h /var/run/postgresql -p 5432 -U postgres -d ee_platform \
    -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS database_role,
       current_setting('server_version') AS pg_version,
       current_setting('transaction_read_only') AS read_only,
       pg_is_in_recovery() AS in_recovery;
SELECT system_identifier::text AS system_identifier FROM pg_control_system();
DO $guard$
BEGIN
  IF current_database() <> 'ee_platform'
     OR (SELECT system_identifier::text FROM pg_control_system()) <> '7686454253092706426'
     OR current_setting('server_version_num')::integer / 10000 <> 18
     OR current_setting('transaction_read_only') <> 'on'
     OR pg_is_in_recovery() THEN
    RAISE EXCEPTION 'Unexpected database, cluster, version or readonly state; STOP';
  END IF;
END $guard$;

SELECT version, sha256 FROM ee_admin.schema_migrations ORDER BY version;
SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('ee_m0_owner','ee_project_api_ro','ee_project_api_rw','ee_project_api_create')
ORDER BY rolname;

SELECT name, to_regclass(name) IS NOT NULL AS present
FROM (VALUES ('ee.app_credentials'), ('ee.fr_allocations'),
             ('ee.allocation_versions'), ('ee.allocation_targets'),
             ('ee.chat_threads'), ('ee.chat_turns')) AS t(name);
SELECT to_regprocedure('ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)') IS NOT NULL
       AS workflow_accept_function_present;
SELECT code FROM ee.permission_definitions
WHERE code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept')
ORDER BY code;

SELECT r.code, r.enabled, count(rp.permission_code) AS permission_count,
       array_agg(rp.permission_code ORDER BY rp.permission_code)
         FILTER (WHERE rp.permission_code IS NOT NULL) AS permissions
FROM ee.access_roles r LEFT JOIN ee.role_permissions rp ON rp.role_id=r.id
WHERE r.code IN ('project_api_author','project_api_reader','function_editor','function_viewer')
GROUP BY r.id,r.code,r.enabled ORDER BY r.code;

SELECT name, has_table_privilege('ee_project_api_rw',name,'INSERT') AS writer_insert
FROM (VALUES ('ee.fr_allocations'), ('ee.allocation_versions'),
             ('ee.allocation_targets')) AS t(name);
SELECT has_column_privilege('ee_project_api_rw','ee.project_subsystem_designs',
                            'lock_version','UPDATE') AS writer_catalog_lock_update;
SELECT md5(prosrc) AS manual_accept_source_md5 FROM pg_proc
WHERE oid=to_regprocedure('ee.accept_manual_revision(uuid,uuid,uuid,uuid,text)');
ROLLBACK;
SQL

  echo 'DB_READONLY_INSPECTION_FINISHED: no backup, migration, or service cutover performed'
)
