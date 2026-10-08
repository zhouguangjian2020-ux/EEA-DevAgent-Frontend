\set ON_ERROR_STOP on
BEGIN;
\ir target.sql
SELECT set_config('ee.workflow_project', :'target_project_id',true),set_config('ee.workflow_actor', :'actor_subject',true);
DO $$
DECLARE p uuid:=current_setting('ee.workflow_project')::uuid; actor uuid; version uuid:=gen_random_uuid(); sub uuid; item record;
BEGIN
 SELECT id INTO actor FROM ee.app_users WHERE external_subject=current_setting('ee.workflow_actor') AND state='active';
 IF actor IS NULL THEN RAISE EXCEPTION 'Active actor missing'; END IF;
 PERFORM 1 FROM ee.projects WHERE id=p AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Target project missing'; END IF;
 PERFORM 1 FROM ee.project_subsystem_designs WHERE project_id=p AND current_version_id IS NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM ee.subsystems WHERE project_id=p) THEN RAISE EXCEPTION 'Catalogue already exists or partially initialized; do not overwrite'; END IF;
 INSERT INTO ee.subsystem_design_versions(id,project_id,version_no,created_by,change_summary) VALUES(version,p,1,actor,'Explicit workflow preset r1');
 FOR item IN SELECT * FROM (VALUES
 ('FCW','前方碰撞预警子系统',1),('BODY','车身控制子系统',2),('POWER','整车电源管理子系统',3),('VEHICLE-STATE','车辆状态管理子系统',4),('PERCEPTION','环境感知子系统',5),('HMI','HMI 子系统',6),('STEERING','转向子系统',7)) t(code,name,position) LOOP
 sub:=gen_random_uuid();
 INSERT INTO ee.subsystems(id,project_id,code,created_by) VALUES(sub,p,item.code,actor);
 INSERT INTO ee.subsystem_version_items(project_id,design_version_id,subsystem_id,name,description,sort_order,is_allocatable) VALUES(p,version,sub,item.name,'预置目录；职责边界待项目工程师补充',item.position,true);
 END LOOP;
 UPDATE ee.project_subsystem_designs SET current_version_id=version,updated_by=actor,updated_at=now(),lock_version=lock_version+1 WHERE project_id=p;
END $$;
SELECT 'PRESET_INITIALIZED_FOR_EXPLICIT_PROJECT_ONLY' AS result;
COMMIT;
