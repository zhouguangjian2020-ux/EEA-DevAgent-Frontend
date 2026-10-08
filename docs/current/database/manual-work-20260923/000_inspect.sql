\set ON_ERROR_STOP on
-- READ ONLY. No account changes, grants, password output or business-row writes.
BEGIN READ ONLY;
\ir 005_target.sql
SELECT current_database() AS database, current_user AS operator,
       system_identifier::text AS system_id FROM pg_control_system();
SELECT wanted.name AS role_name, r.oid IS NOT NULL AS role_exists,
 r.oid, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb,
 r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolvaliduntil,
 r.rolpassword IS NOT NULL AS password_configured,
 CASE WHEN r.oid IS NULL THEN 'absent'
      WHEN r.rolpassword IS NULL THEN 'unset'
      WHEN r.rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram-sha-256'
      WHEN r.rolpassword LIKE 'md5%' THEN 'md5-stop-before-rename'
      ELSE 'unrecognized-stop' END AS password_format
FROM (VALUES ('ee_project_api_ro'),('ee_project_api_create'),('ee_project_api_rw')) wanted(name)
LEFT JOIN pg_authid r ON r.rolname=wanted.name ORDER BY wanted.name;
-- Both membership directions matter, even with NOINHERIT.
SELECT member_role.rolname AS member, parent_role.rolname AS parent
FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
JOIN pg_roles parent_role ON parent_role.oid=m.roleid
WHERE member_role.rolname IN ('ee_project_api_ro','ee_project_api_create','ee_project_api_rw')
   OR parent_role.rolname IN ('ee_project_api_ro','ee_project_api_create','ee_project_api_rw');
SELECT grantee,table_schema,table_name,privilege_type,is_grantable
FROM information_schema.table_privileges
WHERE grantee IN ('ee_project_api_ro','ee_project_api_create','ee_project_api_rw')
ORDER BY grantee,table_schema,table_name,privilege_type;
SELECT grantee,table_schema,table_name,column_name,privilege_type,is_grantable
FROM information_schema.column_privileges
WHERE grantee IN ('ee_project_api_ro','ee_project_api_create','ee_project_api_rw') AND privilege_type='UPDATE'
ORDER BY grantee,table_schema,table_name,column_name;
SELECT r.rolname,p.oid::regprocedure AS routine,has_function_privilege(r.oid,p.oid,'EXECUTE') AS executable
FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE r.rolname IN ('ee_project_api_ro','ee_project_api_create','ee_project_api_rw') AND n.nspname='ee'
 AND has_function_privilege(r.oid,p.oid,'EXECUTE') ORDER BY r.rolname,p.oid;
-- Role names are cluster-wide. Do not silently impact another database/client.
SELECT r.rolname,coalesce(d.datname,'[cluster-wide]') AS database,s.deptype,count(*) AS dependencies
FROM pg_shdepend s JOIN pg_roles r ON r.oid=s.refobjid AND s.refclassid='pg_authid'::regclass
LEFT JOIN pg_database d ON d.oid=s.dbid
WHERE r.rolname IN ('ee_project_api_create','ee_project_api_rw')
GROUP BY r.rolname,d.datname,s.deptype ORDER BY r.rolname,d.datname,s.deptype;
SELECT usename,datname,count(*) AS connections FROM pg_stat_activity
WHERE usename IN ('ee_project_api_create','ee_project_api_rw') GROUP BY usename,datname;
SELECT r.code,r.enabled,pd.code AS permission,pd.enabled AS permission_enabled
FROM ee.access_roles r JOIN ee.role_permissions rp ON rp.role_id=r.id
JOIN ee.permission_definitions pd ON pd.code=rp.permission_code
WHERE r.code IN ('project_api_reader','project_api_author') ORDER BY r.code,pd.code;
\ir 004_verify_reader.sql
COMMIT;
