\set ON_ERROR_STOP on
BEGIN READ ONLY;
\ir target.sql
SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
FROM pg_roles WHERE rolname IN ('ee_project_api_ro','ee_project_api_rw');
SELECT code,resource_kind,action,allowed_scopes,enabled FROM ee.permission_definitions WHERE code IN ('project.update','function.update');
SELECT r.code,p.permission_code FROM ee.role_permissions p JOIN ee.access_roles r ON r.id=p.role_id WHERE p.permission_code IN ('project.update','function.update');
SELECT t,has_any_column_privilege('ee_project_api_rw','ee.'||t,'UPDATE') AS writer_update FROM unnest(ARRAY['projects','business_functions']) t;
COMMIT;
