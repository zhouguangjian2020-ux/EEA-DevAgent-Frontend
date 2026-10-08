\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
SELECT current_database() AS database, (SELECT system_identifier::text FROM pg_control_system()) AS system_id, current_user AS operator;
SELECT to_regclass('ee.app_credentials') AS credentials_table,
       to_regclass('ee.access_bindings_one_function_role') AS function_scope_unique_index;
SELECT code,name,enabled FROM ee.access_roles WHERE code IN ('project_api_author','project_api_reader','function_viewer','function_editor') ORDER BY code;
SELECT r.code, array_agg(rp.permission_code ORDER BY rp.permission_code) AS permissions
FROM ee.access_roles r LEFT JOIN ee.role_permissions rp ON rp.role_id=r.id
WHERE r.code IN ('project_api_author','project_api_reader','function_viewer','function_editor')
GROUP BY r.code ORDER BY r.code;
SELECT grantee,table_name,privilege_type
FROM information_schema.table_privileges
WHERE grantee IN ('ee_project_api_ro','ee_project_api_rw') AND table_schema='ee' AND table_name IN ('app_credentials','app_users','project_members','access_bindings')
ORDER BY grantee,table_name,privilege_type;
COMMIT;
