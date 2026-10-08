import contextlib
import copy
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE=Path(__file__).resolve().parent
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
m=load('frontend_cutover','cutover_frontend_workflows_20261004_r2.py')
helper=load('reviewed_helper','cutover_main_workflows_20261004_r1.py')
OLD_ID='1'*64
NEW_ID='2'*64
MAIN_ID='3'*64
SECRET='NEVER_PRINT_SECRET=space value = private_token'

def state(running=False,status=None):
    return dict(Running=running,Status=status or ('running' if running else 'exited'),
                Paused=False,Dead=False,Restarting=False,StartedAt='2026-10-04T00:00:00Z',
                FinishedAt='0001-01-01T00:00:00Z')

def frontend():
    return dict(Id=OLD_ID,Name='/'+m.OLD,Image=m.OLD_IMAGE_ID,RestartCount=0,Mounts=[],State=state(True),
        Config=dict(Image=m.OLD_IMAGE_ID,Hostname='old-host',Entrypoint=['docker-entrypoint.sh'],Cmd=m.CMD,
                    WorkingDir='/app',User='',Env=['BACKEND_URL=http://192.168.64.3:7000',SECRET],
                    Healthcheck=None,Labels={},ExposedPorts={'7100/tcp':{}},Tty=False,OpenStdin=False),
        HostConfig=dict(NetworkMode='host',RestartPolicy=dict(Name='unless-stopped',MaximumRetryCount=0),
                        OomKillDisable=None,ConsoleSize=[41,81],Memory=0,Binds=None))

def candidate(old=None):
    item=copy.deepcopy(old or frontend())
    item.update(Id=NEW_ID,Name='/'+m.NEW,Image=m.IMAGE_ID,State=state(False,'created'))
    item['State']['StartedAt']='0001-01-01T00:00:00Z'
    item['Config'].update(Image=m.IMAGE_ID,Hostname='new-host')
    item['HostConfig'].update(OomKillDisable=False,ConsoleSize=[0,0])
    return item

def receipt():
    return dict(phase='completed',database='ee_platform',system_identifier='7686454253092706426',
        apply_attempted=True,apply_committed=True,schema_verified=True,main_running_verified=True,
        main_container_id=MAIN_ID,main_image_id=m.MAIN_IMAGE_ID,maintenance_active=True,
        presets_initialized=False,other_services_changed=False)

class FakeDocker:
    environment=staticmethod(helper.environment)
    host_differences=staticmethod(helper.host_differences)
    require_prepared=staticmethod(helper.require_prepared)
    validate_openapi=staticmethod(helper.validate_openapi)
    NoRedirect=helper.NoRedirect
    OLD=helper.OLD
    OLD_ID=helper.OLD_ID
    PREVIEW=helper.PREVIEW
    PREVIEW_ID=helper.PREVIEW_ID
    def __init__(self):
        self.items={m.OLD:frontend()}
        for index,(name,(image,running)) in enumerate(m.RETAINED.items()):
            identity={m.MAIN:MAIN_ID,helper.OLD:helper.OLD_ID,helper.PREVIEW:helper.PREVIEW_ID}.get(name,'4'*64)
            self.items[name]=dict(Id=identity,Name='/'+name,Image=image,State=state(running),RestartCount=0,
                Config={'Env':['BUSINESS_WRITES_ENABLED='+('false' if name==helper.PREVIEW else 'true')]},
                HostConfig={'NetworkMode':'host','RestartPolicy':{'Name':'unless-stopped','MaximumRetryCount':0}},
                Mounts=[{'Type':'bind','Source':'private-console-path'}] if 'console-2026' in name and running else [])
        self.image_id=m.IMAGE_ID
        self.calls=[]
        self.env_paths=[]
        self.env_payload=None
        self.on_create=None
        self.on_start=None
        self.fail_create=False
        self.fail_start=False
        self.fail_old_start=False
        self.fail_old_stop=False
        self.fail_new_stop=False
        self.fail_list=False
        self.fail_health=False
    def inspect(self,name):
        if name in self.items:
            return copy.deepcopy(self.items[name])
        for item in self.items.values():
            if item['Id']==name:
                return copy.deepcopy(item)
        raise RuntimeError('DOCKER_FAILED: inspect; stderr withheld')
    def object(self,identity):
        for item in self.items.values():
            if item['Id']==identity:
                return item
        raise AssertionError('Unknown ID')
    def http_json(self,url):
        if url.endswith('/openapi.json'):
            return {'paths':{p:{method:{}} for p,method in dict(helper.EXPECTED_PATHS, **{'/v1/auth/login':'post','/v1/auth/me':'get','/v1/projects':'get'}).items()}}
        return {'status':'bad' if self.fail_health else 'ok'}
    def docker(self,*args,timeout=30):
        self.calls.append(args)
        if args[:2]==('image','inspect'):
            return json.dumps([{'Id':self.image_id,'Config':frontend()['Config']}])
        if args[0]=='ps':
            if self.fail_list:
                raise RuntimeError('DOCKER_FAILED: ps; stderr withheld')
            return '\n'.join(self.items)
        if args[0]=='create':
            path=Path(args[args.index('--env-file')+1])
            self.env_paths.append(path)
            self.env_payload=path.read_text(encoding='utf-8')
            assert args[args.index('--pull')+1]=='never'
            assert m.IMAGE_ID in args and m.IMAGE not in args
            assert args[args.index('--name')+1]==m.NEW
            if self.fail_create:
                raise RuntimeError(SECRET)
            self.items[m.NEW]=candidate(self.items[m.OLD])
            if self.on_create:
                self.on_create(self)
            return NEW_ID+'\n'
        if args[0] not in ('start','stop','update'):
            raise AssertionError('Non-frontend operation')
        identity=args[-1]
        assert identity in (OLD_ID,NEW_ID), 'Retained service mutation!'
        item=self.object(identity)
        if args[0]=='update':
            assert identity==NEW_ID and args[1]=='--restart=no'
            item['HostConfig']['RestartPolicy']={'Name':'no','MaximumRetryCount':0}
        elif args[0]=='stop':
            if (identity==OLD_ID and self.fail_old_stop) or (identity==NEW_ID and self.fail_new_stop):
                raise RuntimeError('DOCKER_FAILED: stop; stderr withheld')
            item['State']=state(False)
        else:
            if (identity==NEW_ID and self.fail_start) or (identity==OLD_ID and self.fail_old_start):
                raise RuntimeError('DOCKER_FAILED: start; stderr withheld')
            item['State']=state(True)
            if self.on_start:
                self.on_start(self,identity)
        return identity
    def mutations(self):
        return [a for a in self.calls if a[0] not in ('ps','image','inspect')]

class CutoverTests(unittest.TestCase):
    def setUp(self):
        self.h=FakeDocker()
        self.r=receipt()
        self.wait_error=None
    def run_stage(self,**kwargs):
        output=io.StringIO()
        def wait(h,name,identity,image):
            if name==m.NEW and self.wait_error:
                raise self.wait_error
            item=h.inspect(name)
            assert item['Id']==identity and item['Image']==image and item['State']['Running']
        with contextlib.redirect_stdout(output), mock.patch.object(m,'load_helper',return_value=self.h), \
             mock.patch.object(m,'validate_migration_receipt',return_value=self.r), \
             mock.patch.object(m,'frontend_healthy',return_value=True), mock.patch.object(m,'wait_frontend',side_effect=wait):
            result=m.deploy(**kwargs)
        text=output.getvalue()
        self.assertNotIn(SECRET,text)
        for path in self.h.env_paths:
            self.assertFalse(path.exists())
            self.assertFalse(path.parent.exists())
        return result,text
    def assert_no_stop(self):
        self.assertFalse(any(a[0]=='stop' for a in self.h.calls))
        self.assertTrue(self.h.items[m.OLD]['State']['Running'])
    def test_check_only_has_no_mutations(self):
        code,text=self.run_stage(check_only=True)
        self.assertEqual(code,0)
        self.assertIn('CHECK_ONLY_OK',text)
        self.assertEqual(self.h.mutations(),[])
    def test_success_changes_only_frontends(self):
        retained=copy.deepcopy({k:self.h.items[k] for k in m.RETAINED})
        code,text=self.run_stage()
        self.assertEqual(code,0,text)
        self.assertIn('FRONTEND_WORKFLOWS_CUTOVER_OK',text)
        self.assertEqual([a[0] for a in self.h.mutations()],['create','stop','start'])
        self.assertFalse(self.h.items[m.OLD]['State']['Running'])
        self.assertTrue(self.h.items[m.NEW]['State']['Running'])
        self.assertEqual(retained,{k:self.h.items[k] for k in m.RETAINED})
        self.assertIn(SECRET,self.h.env_payload)
    def test_oom_default_and_console_size_are_equivalent(self):
        m.compare_target(self.h,self.h.items[m.OLD],candidate())
    def test_oom_true_and_invalid_type_rejected(self):
        for value in (True,0,'false'):
            with self.subTest(value=value):
                item=candidate()
                item['HostConfig']['OomKillDisable']=value
                with self.assertRaises(RuntimeError):
                    m.compare_target(self.h,frontend(),item)
    def test_env_drift_rejected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.NEW]['Config']['Env'].append('INJECTED=yes')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('ENV_MISMATCH',text)
        self.assert_no_stop()
    def test_tag_drift_rejected_without_mutation(self):
        self.h.image_id='sha256:'+'a'*64
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('TAG_CHANGED',text)
        self.assertEqual(self.h.mutations(),[])
    def test_created_image_drift_rejected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.NEW].update(Image='sha256:'+'b'*64)
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_created_mounts_rejected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.NEW]['Mounts'].append({'Source':'sensitive'})
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_true_host_config_drift_rejected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.NEW]['HostConfig'].update(Memory=1234)
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('HOST_CONFIG_MISMATCH',text)
        self.assert_no_stop()
    def test_startup_config_drift_rejected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.NEW]['Config'].update(Cmd=['unexpected'])
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_existing_target_requires_explicit_resume(self):
        self.h.items[m.NEW]=candidate()
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('TARGET_EXISTS',text)
        self.assertEqual(self.h.mutations(),[])
    def test_resume_created_checks_without_mutation(self):
        self.h.items[m.NEW]=candidate()
        code,text=self.run_stage(check_only=True,resume_created=True)
        self.assertEqual(code,0,text)
        self.assertEqual(self.h.mutations(),[])
    def test_resume_created_success_does_not_recreate(self):
        self.h.items[m.NEW]=candidate()
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,0,text)
        self.assertEqual([a[0] for a in self.h.mutations()],['stop','start'])
    def test_resume_missing_target_refused(self):
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_resume_started_target_refused(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']=state(False)
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_resume_exited_target_refused(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']['Status']='exited'
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_resume_restart_history_refused(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['RestartCount']=1
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_create_failure_keeps_old_and_cleans_secret_file(self):
        self.h.fail_create=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
        self.assertTrue(self.h.env_paths)
    def test_listing_error_is_not_treated_as_absence(self):
        self.h.fail_list=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_main_identity_must_match_migration_receipt(self):
        self.r['main_container_id']='e'*64
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_preview_must_remain_stopped(self):
        self.h.items[helper.PREVIEW]['State']=state(True)
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_preview_write_policy_must_stay_disabled(self):
        self.h.items[helper.PREVIEW]['Config']['Env']=['BUSINESS_WRITES_ENABLED=true']
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_main_backend_health_failure_stops_preflight(self):
        self.h.fail_health=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])
    def test_retained_console_config_change_detected_before_stop(self):
        name='ts-agent-console-20261002-r7'
        self.h.on_create=lambda h:h.items[name]['Mounts'].clear()
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('RETAINED_SERVICE_CHANGED',text)
        self.assert_no_stop()
    def test_retained_backend_restart_detected_before_stop(self):
        self.h.on_create=lambda h:h.items[m.MAIN]['State'].update(StartedAt='changed')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_start_failure_recovers_only_old_frontend(self):
        self.h.fail_start=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('FRONTEND_ROLLBACK_OK',text)
        self.assertTrue(self.h.items[m.OLD]['State']['Running'])
        self.assertEqual(self.h.items[m.NEW]['HostConfig']['RestartPolicy']['Name'],'no')
    def test_health_failure_stops_new_then_restores_old(self):
        self.wait_error=m.CutoverError('FRONTEND_READINESS_TIMEOUT')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('FRONTEND_ROLLBACK_OK',text)
        self.assertEqual([a[0] for a in self.h.mutations()],['create','stop','start','update','stop','start'])
    def test_interruption_recovers_frontend(self):
        self.wait_error=KeyboardInterrupt()
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('FRONTEND_ROLLBACK_OK',text)
    def test_stop_failure_keeps_old_running_without_duplicate_start(self):
        self.h.fail_old_stop=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('FRONTEND_ROLLBACK_OK',text)
        self.assertFalse(any(a[0]=='start' for a in self.h.calls))
    def test_rollback_start_failure_reported(self):
        self.h.fail_start=True
        self.h.fail_old_start=True
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('ROLLBACK_NOT_CONFIRMED',text)
        self.assertNotIn('ROLLBACK_OK',text)
    def test_failed_new_stop_does_not_start_old_into_occupied_port(self):
        self.h.fail_new_stop=True
        self.wait_error=m.CutoverError('FRONTEND_READINESS_TIMEOUT')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('ROLLBACK_NOT_CONFIRMED',text)
        self.assertFalse(any(a[0]=='start' and a[-1]==OLD_ID for a in self.h.calls))
    def test_replaced_candidate_refuses_recovery(self):
        def changed(h,identity):
            if identity==NEW_ID:
                h.items[m.NEW]['Id']='f'*64
        self.h.on_start=changed
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('ROLLBACK_NOT_CONFIRMED',text)
        self.assertFalse(any(a[0]=='update' for a in self.h.calls))
    def test_mutation_allowlist_refuses_backend(self):
        with self.assertRaises(m.CutoverError):
            m.mutate_frontend(self.h,'stop',MAIN_ID,OLD_ID,NEW_ID)
        self.assertEqual(self.h.mutations(),[])
    def test_no_old_restart_policy_mutation(self):
        with self.assertRaises(m.CutoverError):
            m.mutate_frontend(self.h,'disable-restart',OLD_ID,OLD_ID,NEW_ID)
        self.assertEqual(self.h.mutations(),[])
    def test_helper_hash_matches_pinned_source(self):
        with mock.patch.object(m,'HELPER',HERE/'cutover_main_workflows_20261004_r1.py'):
            imported=m.load_helper()
        self.assertTrue(callable(imported.host_differences))
    def test_helper_hash_mismatch_prevents_import(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bad.py'
            path.write_text('raise AssertionError("MUST_NOT_IMPORT")',encoding='utf-8')
            with mock.patch.object(m,'HELPER',path),self.assertRaises(m.CutoverError):
                m.load_helper()

    def test_unhealthy_initial_frontend_prevents_create(self):
        with mock.patch.object(m,'load_helper',return_value=self.h), \
             mock.patch.object(m,'validate_migration_receipt',return_value=self.r), \
             mock.patch.object(m,'frontend_healthy',return_value=False),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.deploy(),1)
        self.assertEqual(self.h.mutations(),[])
    def test_missing_receipt_prevents_all_mutations(self):
        with mock.patch.object(m,'load_helper',return_value=self.h), \
             mock.patch.object(m,'validate_migration_receipt',side_effect=FileNotFoundError), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.deploy(),1)
        self.assertEqual(self.h.mutations(),[])
    def test_source_id_drift_after_create_keeps_service_running(self):
        self.h.on_create=lambda h:h.items[m.OLD].update(Id='a'*64)
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_source_env_drift_after_create_keeps_service_running(self):
        self.h.on_create=lambda h:h.items[m.OLD]['Config']['Env'].append('CHANGED=yes')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assert_no_stop()
    def test_drift_during_start_refuses_automatic_recovery(self):
        def changed(h,identity):
            if identity==NEW_ID:
                h.items[m.MAIN]['State']['StartedAt']='unexpected-restart'
        self.h.on_start=changed
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('ROLLBACK_NOT_CONFIRMED',text)
        self.assertFalse(self.h.items[m.NEW]['State']['Running'])
        self.assertFalse(any(a[0]=='start' and a[-1]==OLD_ID for a in self.h.calls))
    def test_three_consecutive_health_successes_required(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']=state(True)
        with mock.patch.object(m.time,'monotonic',side_effect=range(12)), \
             mock.patch.object(m.time,'sleep'), \
             mock.patch.object(m,'frontend_healthy',side_effect=[True,False,True,True,True]) as healthy:
            m.wait_frontend(self.h,m.NEW,NEW_ID,m.IMAGE_ID)
        self.assertEqual(healthy.call_count,5)
    def test_readiness_timeout_never_reports_success(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']=state(True)
        with mock.patch.object(m.time,'monotonic',side_effect=[0,1,61]), \
             mock.patch.object(m.time,'sleep'),mock.patch.object(m,'frontend_healthy',return_value=False):
            with self.assertRaisesRegex(RuntimeError,'READINESS_TIMEOUT'):
                m.wait_frontend(self.h,m.NEW,NEW_ID,m.IMAGE_ID)
    def test_readiness_rejects_changed_image(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['Image']='sha256:'+'0'*64
        with self.assertRaisesRegex(RuntimeError,'IDENTITY_CHANGED'):
            m.wait_frontend(self.h,m.NEW,NEW_ID,m.IMAGE_ID)
    def test_restarting_target_cannot_pass_readiness(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']=state(True)
        self.h.items[m.NEW]['State']['Restarting']=True
        with mock.patch.object(m.time,'monotonic',side_effect=[0,1,61]), \
             mock.patch.object(m.time,'sleep'),mock.patch.object(m,'frontend_healthy',return_value=True):
            with self.assertRaisesRegex(RuntimeError,'READINESS_TIMEOUT'):
                m.wait_frontend(self.h,m.NEW,NEW_ID,m.IMAGE_ID)
    def test_multiline_and_duplicate_env_refused(self):
        for env in (['KEY=one','KEY=two'],['KEY=line\nnext']):
            with self.subTest(env=env),self.assertRaises(RuntimeError):
                self.h.environment({'Env':env})
    def test_windows_entrypoint_refuses_before_helper_load(self):
        with mock.patch.object(m.sys,'platform','win32'),mock.patch.object(m,'load_helper') as loader, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(),2)
        loader.assert_not_called()

    def test_unknown_config_field_drift_rejected(self):
        self.h.on_create=lambda h:h.items[m.NEW]['Config'].update(UnexpectedField='different')
        code,text=self.run_stage()
        self.assertEqual(code,1)
        self.assertIn('CONFIG_MISMATCH',text)
        self.assert_no_stop()
    def test_created_state_with_previous_start_rejected(self):
        self.h.items[m.NEW]=candidate()
        self.h.items[m.NEW]['State']['StartedAt']='2026-10-04T00:00:00Z'
        code,text=self.run_stage(resume_created=True)
        self.assertEqual(code,1)
        self.assertEqual(self.h.mutations(),[])

class ReceiptTests(unittest.TestCase):
    def setUp(self):
        from types import SimpleNamespace
        self.path=mock.MagicMock()
        self.path.resolve.return_value=self.path
        self.path.lstat.return_value=SimpleNamespace(st_mode=m.stat.S_IFREG|0o600)
        self.path.parent.stat.return_value=SimpleNamespace(st_mode=m.stat.S_IFDIR|0o700)
        self.data=receipt()
    def validate(self):
        self.path.read_text.return_value=json.dumps(self.data)
        with mock.patch.object(m,'MIGRATION_RECEIPT',self.path):
            return m.validate_migration_receipt()
    def test_completed_receipt_valid(self):
        self.assertEqual(self.validate(),self.data)
    def test_incomplete_or_wrong_target_rejected(self):
        for key,value in [('phase','preflight'),('database','other'),('system_identifier','other'),
            ('apply_attempted',False),('apply_committed',False),('schema_verified',False),
            ('main_running_verified',False),('main_container_id','short'),
            ('main_image_id','other'),('error','sensitive detail'),('maintenance_active',False),
            ('presets_initialized',True),('other_services_changed',True)]:
            with self.subTest(key=key):
                self.data=receipt()
                self.data[key]=value
                with self.assertRaises(m.CutoverError):
                    self.validate()
    def test_public_receipt_rejected(self):
        self.path.lstat.return_value.st_mode=m.stat.S_IFREG|0o644
        with self.assertRaises(m.CutoverError):
            self.validate()
    def test_public_parent_rejected(self):
        self.path.parent.stat.return_value.st_mode=m.stat.S_IFDIR|0o755
        with self.assertRaises(m.CutoverError):
            self.validate()
    def test_symlink_or_redirected_receipt_rejected(self):
        self.path.resolve.return_value=Path('/other')
        with self.assertRaises(m.CutoverError):
            self.validate()
    def test_non_regular_receipt_rejected(self):
        self.path.lstat.return_value.st_mode=m.stat.S_IFDIR|0o700
        with self.assertRaises(m.CutoverError):
            self.validate()

# A fixture mistake must not invoke a real process or connect to any service.
def setUpModule():
    global guard
    guard=contextlib.ExitStack()
    guard.enter_context(mock.patch('subprocess.run',side_effect=AssertionError('Real process forbidden in tests')))
    guard.enter_context(mock.patch('socket.create_connection',side_effect=AssertionError('Network forbidden in tests')))

def tearDownModule():
    guard.close()

if __name__=='__main__':
    unittest.main()
