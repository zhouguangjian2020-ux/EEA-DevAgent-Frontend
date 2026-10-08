\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
\ir target.sql
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pg_roles WHERE rolname='ee_project_api_rw';
 IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
  RAISE EXCEPTION 'Unsafe or missing shared writer';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ee_project_api_create') THEN
  RAISE EXCEPTION 'Old writer name still exists; complete the reviewed writer rename first';
 END IF;
 IF to_regclass('ee.app_credentials') IS NOT NULL THEN
  RAISE EXCEPTION 'Permission package already applied or partially applied; run verify.sql, do not rerun apply.sql';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ee.access_roles WHERE code='project_api_author' AND enabled) THEN
  RAISE EXCEPTION 'Project author role missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ee.permission_definitions WHERE code='project.update' AND enabled) THEN
  RAISE EXCEPTION 'Metadata baseline missing; apply the reviewed metadata package first';
 END IF;
 IF EXISTS (SELECT 1 FROM ee.access_roles WHERE code IN ('function_viewer','function_editor')) THEN
  RAISE EXCEPTION 'Function roles already exist; inspect and verify instead of rerunning apply.sql';
 END IF;
 IF EXISTS (SELECT 1 FROM ee.permission_definitions WHERE code='project.manage_access') THEN
  RAISE EXCEPTION 'project.manage_access already exists; inspect and verify instead of rerunning apply.sql';
 END IF;
 IF to_regclass('ee.access_bindings_one_function_role') IS NOT NULL THEN
  RAISE EXCEPTION 'Function binding uniqueness already exists; inspect and verify instead of rerunning apply.sql';
 END IF;
 IF EXISTS (
   SELECT 1 FROM ee.permission_definitions
   WHERE code IN ('function.read','prd.read','uc.read','fr.read','fr_allocation.read')
     AND (NOT enabled OR allowed_scopes <> ARRAY['project']::text[])
 ) THEN
  RAISE EXCEPTION 'Existing read permission definitions drifted; review before applying';
 END IF;
END $$;
CREATE TABLE ee.app_credentials (
  user_id uuid NOT NULL,
  login_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_credentials_pk PRIMARY KEY (user_id),
  CONSTRAINT app_credentials_uq_0 UNIQUE (login_name),
  CONSTRAINT app_credentials_fk_0 FOREIGN KEY (user_id) REFERENCES ee.app_users(id) ON DELETE NO ACTION,
  CONSTRAINT app_credentials_ck_0 CHECK (login_name = lower(btrim(login_name)) AND length(login_name) BETWEEN 1 AND 100),
  CONSTRAINT app_credentials_ck_1 CHECK (length(password_hash) >= 20)
);
ALTER TABLE ee.access_bindings DROP CONSTRAINT access_bindings_ck_1;
ALTER TABLE ee.access_bindings ADD CONSTRAINT access_bindings_ck_1 CHECK (scope_kind IN ('project','function','artifact'));
CREATE UNIQUE INDEX access_bindings_one_function_role
  ON ee.access_bindings(project_id,user_id,function_id)
  WHERE scope_kind='function' AND artifact_id IS NULL;
INSERT INTO ee.permission_definitions(code,display_name,description,resource_kind,action,allowed_scopes)
VALUES
 ('project.manage_access','管理项目成员和权限','仅项目管理员可使用；第一版只暴露固定项目/功能角色','project','manage_access',ARRAY['project']::text[]),
 ('function.read','功能读取','读取功能范围内的工作内容','function','read',ARRAY['project','function']::text[]),
 ('prd.read','PRD读取','读取PRD','PRD','read',ARRAY['project','function']::text[]),
 ('uc.read','UC读取','读取UC','UC','read',ARRAY['project','function']::text[]),
 ('fr.read','FR读取','读取FR','FR','read',ARRAY['project','function']::text[]),
 ('fr_allocation.read','FR分配读取','读取FR分配','FR_ALLOCATION','read',ARRAY['project','function']::text[]),
 ('function.update','修改功能资料','修改功能名称和描述','function','update',ARRAY['project','function']::text[]),
 ('prd.create','创建PRD','在功能范围内创建PRD','PRD','create',ARRAY['project','function']::text[]),
 ('prd.update','修改PRD','在功能范围内修改PRD','PRD','update',ARRAY['project','function']::text[]),
 ('prd.accept','确认PRD','在功能范围内确认PRD','PRD','accept',ARRAY['project','function']::text[]),
 ('uc.create','创建UC','在功能范围内创建UC','UC','create',ARRAY['project','function']::text[]),
 ('uc.update','修改UC','在功能范围内修改UC','UC','update',ARRAY['project','function']::text[]),
 ('uc.accept','确认UC','在功能范围内确认UC','UC','accept',ARRAY['project','function']::text[]),
 ('fr.create','创建FR','在功能范围内创建FR','FR','create',ARRAY['project','function']::text[]),
 ('fr.update','修改FR','在功能范围内修改FR','FR','update',ARRAY['project','function']::text[]),
 ('fr.accept','确认FR','在功能范围内确认FR','FR','accept',ARRAY['project','function']::text[])
ON CONFLICT (code) DO UPDATE
SET allowed_scopes=EXCLUDED.allowed_scopes, updated_at=clock_timestamp();
INSERT INTO ee.access_roles(id,code,name,description,is_system,enabled)
VALUES
 ('3e6af0b9-1f29-52cf-8d6b-31a9f5f4a701','function_viewer','功能查看者','仅查看当前功能；不改变项目级权限',true,true),
 ('3e6af0b9-1f29-52cf-8d6b-31a9f5f4a702','function_editor','功能编辑者','查看、编辑、工程审查和确认当前功能；不包含成员管理',true,true);
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM ee.access_roles r
JOIN ee.permission_definitions p ON p.code = ANY(ARRAY['function.read','prd.read','uc.read','fr.read','fr_allocation.read']::text[])
WHERE r.code='function_viewer';
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM ee.access_roles r
JOIN ee.permission_definitions p ON p.code = ANY(ARRAY[
 'function.read','prd.read','uc.read','fr.read','fr_allocation.read','function.update',
 'prd.create','prd.update','prd.accept','uc.create','uc.update','uc.accept','fr.create','fr.update','fr.accept'
]::text[])
WHERE r.code='function_editor';
INSERT INTO ee.role_permissions(role_id,permission_code)
SELECT r.id,'project.manage_access' FROM ee.access_roles r
WHERE r.code='project_api_author'
ON CONFLICT DO NOTHING;
GRANT SELECT ON ee.app_credentials TO ee_project_api_ro;
GRANT SELECT (user_id,login_name) ON ee.app_credentials TO ee_project_api_rw;
GRANT INSERT (id,external_subject,display_name,metadata), UPDATE (display_name,metadata,state,updated_at) ON ee.app_users TO ee_project_api_rw;
GRANT INSERT (user_id,login_name,password_hash) ON ee.app_credentials TO ee_project_api_rw;
GRANT UPDATE (state,updated_at) ON ee.project_members TO ee_project_api_rw;
GRANT INSERT (id,project_id,user_id,scope_kind,function_id,artifact_id,role_id,created_by,updated_by),
      UPDATE (role_id,updated_by,updated_at), DELETE ON ee.access_bindings TO ee_project_api_rw;
\ir assertions.sql
COMMIT;
