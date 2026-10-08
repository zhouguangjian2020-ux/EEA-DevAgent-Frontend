import contextlib
import copy
import importlib.util
import io
import json
import os
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

p = Path(__file__).with_name('cutover_main_workflows_20261004_r1.py')
spec = importlib.util.spec_from_file_location('cutover', p)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SECRET = 'SECRET_DO_NOT_PRINT=this value contains spaces and = signs'

def source():
    return {
        'Id': m.OLD_ID, 'Image': m.OLD_IMAGE_ID, 'RestartCount': 0, 'Mounts': [],
        'State': {'Status': 'exited', 'Running': False, 'Paused': False, 'Dead': False, 'Restarting': False},
        'Config': {'Image': 'old-tag', 'Entrypoint': None, 'Cmd': m.CMD, 'WorkingDir': '/app', 'User': '',
                   'Env': ['APP_ENV=production', 'BUSINESS_WRITES_ENABLED=true', SECRET] +
                   [k+'=private-value' for k in ('PROJECTS_DATABASE_URL','PROJECTS_WRITE_DATABASE_URL',
                    'AGENT_INVOKE_URL','AGENT_GENERATION_INVOKE_URL','AGENT_API_KEY','AGENT_CALLBACK_KEY')]},
        'HostConfig': {'NetworkMode': 'host', 'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
                       'ConsoleSize': [41,81], 'OomKillDisable': None, 'LogConfig': {'Type':'json-file','Config':{}}},
    }

class FakeDocker:
    def __init__(self, failure=None):
        self.failure = failure
        self.calls = []
        self.env_paths = []
        self.containers = {m.OLD: source()}
        preview = source()
        preview.update(Id=m.PREVIEW_ID, Image=m.PREVIEW_IMAGE_ID)
        preview['Config']['Env'] = ['BUSINESS_WRITES_ENABLED=false']
        self.containers[m.PREVIEW] = preview
        for name, image in m.UNCHANGED.items():
            item = source()
            item.update(Id=name+'-id', Image=image)
            item['State'].update(Status='running', Running=True)
            if 'console' in name:
                item['Mounts'] = [{'Type':'bind','Source':'/private-existing-console-data','Destination':'/data'}]
            self.containers[name] = item

    def prepared(self):
        target = copy.deepcopy(self.containers[m.OLD])
        target.update(Id='new-id', Image=m.IMAGE_ID)
        target['Config']['Image'] = m.IMAGE_ID
        target['State']['Status'] = 'created'
        target['HostConfig'].update(OomKillDisable=False, ConsoleSize=[0,0])
        self.containers[m.NEW] = target
        return target

    def get(self, key):
        if key in self.containers: return self.containers[key]
        return next(c for c in self.containers.values() if c['Id'] == key)

    def __call__(self, *args, timeout=30):
        self.calls.append(args)
        op = args[0]
        if op == 'inspect': return json.dumps([self.get(args[1])])
        if op == 'ps': return '\n'.join(self.containers)
        if op == 'image': return json.dumps([{'Id': 'wrong' if self.failure == 'image' else m.IMAGE_ID}])
        if op == 'create':
            assert '--pull' in args and args[args.index('--pull')+1] == 'never'
            assert m.IMAGE_ID in args and m.IMAGE not in args
            path = Path(args[args.index('--env-file')+1])
            self.env_paths.append(path)
            assert path.read_text(encoding='utf-8').splitlines() == self.containers[m.OLD]['Config']['Env']
            if self.failure == 'create': raise RuntimeError('CREATE_FAILED')
            target = self.prepared()
            if self.failure == 'env': target['Config']['Env'].append('EXTRA=private')
            if self.failure == 'oom': target['HostConfig']['OomKillDisable'] = True
            if self.failure == 'log': target['HostConfig']['LogConfig']['Type'] = 'none'
            if self.failure == 'command': target['Config']['Cmd'] = ['bad']
            if self.failure == 'mount': target['Mounts'] = [{'Source':'unexpected'}]
            if self.failure == 'source-race': self.containers[m.OLD]['Config']['User'] = 'changed'
            if self.failure == 'preview-race': self.containers[m.PREVIEW]['State'].update(Status='running',Running=True)
            return 'new-id'
        if op == 'start':
            assert args[1] == 'new-id', 'NEVER START OLD SERVICES'
            self.get(args[1])['State'].update(Status='running',Running=True)
            if self.failure == 'start': raise RuntimeError('START_FAILED_AFTER_ACCEPT')
            return 'new-id'
        if op == 'update':
            assert args == ('update','--restart=no','new-id')
            self.get('new-id')['HostConfig']['RestartPolicy']['Name'] = 'no'
            return 'new-id'
        if op == 'stop':
            assert args[-1] == 'new-id', 'NEVER STOP OTHER SERVICES'
            if self.failure == 'stop': raise RuntimeError('STOP_FAILED')
            self.get('new-id')['State'].update(Status='exited',Running=False)
            return 'new-id'
        raise AssertionError('Unexpected Docker mutation: '+op)

class CutoverTests(unittest.TestCase):
    def execute(self, fake=None, readiness=None, backup_error=None, ports_error=None, **kwargs):
        fake = fake or FakeDocker()
        output = io.StringIO()
        before_umask = os.umask(0o077)
        try:
            with mock.patch.object(m,'docker',fake), mock.patch.object(m,'validate_backup',side_effect=backup_error), \
                 mock.patch.object(m,'check_backup_age'), mock.patch.object(m,'require_free_ports',side_effect=ports_error), \
                 mock.patch.object(m,'wait_ready',side_effect=readiness), mock.patch.object(m.signal,'signal'), \
                 contextlib.redirect_stdout(output):
                result = m.deploy(**kwargs)
        finally:
            os.umask(before_umask)
        text = output.getvalue()
        self.assertNotIn(SECRET, text)
        self.assertNotIn('private-value', text)
        for path in fake.env_paths: self.assertFalse(path.exists())
        self.assertFalse(fake.containers[m.OLD]['State']['Running'])
        self.assertFalse(any(c[0] in ('rm','build','run','exec','restart') for c in fake.calls))
        return result, fake, text

    def test_success_preserves_old_and_only_starts_new(self):
        result, fake, text = self.execute()
        self.assertEqual(result,0); self.assertIn('MAIN_BACKEND_CUTOVER_OK',text)
        self.assertEqual([c[0] for c in fake.calls if c[0] in ('create','start','stop','update')],['create','start'])
        self.assertFalse(fake.containers[m.PREVIEW]['State']['Running'])
        self.assertEqual(m.environment(fake.containers[m.OLD]['Config']),m.environment(fake.containers[m.NEW]['Config']))

    def test_check_only_never_mutates(self):
        result, fake, text = self.execute(check_only=True)
        self.assertEqual(result,0); self.assertIn('CHECK_ONLY_OK',text)
        self.assertTrue(all(c[0] in ('inspect','ps','image') for c in fake.calls))

    def test_resume_created(self):
        fake = FakeDocker(); fake.prepared()
        result, fake, _ = self.execute(fake,resume_created=True)
        self.assertEqual(result,0); self.assertFalse(any(c[0]=='create' for c in fake.calls))

    def test_resume_check_only(self):
        fake = FakeDocker(); fake.prepared()
        result, fake, _ = self.execute(fake,resume_created=True,check_only=True)
        self.assertEqual(result,0); self.assertTrue(all(c[0] in ('inspect','ps','image') for c in fake.calls))

    def test_prestart_failures_never_start(self):
        for failure in ('image','create','env','oom','log','command','mount','source-race','preview-race'):
            with self.subTest(failure=failure):
                result, fake, _ = self.execute(FakeDocker(failure))
                self.assertEqual(result,1); self.assertFalse(any(c[0] in ('start','stop','update') for c in fake.calls))

    def test_stopped_identity_and_policies(self):
        changes = [('Image','wrong'),('Id','wrong'),('Mounts',[{'Source':'x'}])]
        for key,value in changes:
            with self.subTest(key=key):
                fake=FakeDocker(); fake.containers[m.OLD][key]=value
                result, fake, _=self.execute(fake)
                self.assertEqual(result,1); self.assertFalse(any(c[0]=='create' for c in fake.calls))
        fake=FakeDocker(); fake.containers[m.OLD]['State']['Status']='running'
        result, _, _=self.execute(fake); self.assertEqual(result,1)
        fake=FakeDocker(); fake.containers[m.PREVIEW]['Config']['Env']=['BUSINESS_WRITES_ENABLED=true']
        result, _, _=self.execute(fake); self.assertEqual(result,1)

    def test_backup_failure_prevents_all_docker_work(self):
        result,fake,_=self.execute(backup_error=RuntimeError('BAD_BACKUP'))
        self.assertEqual(result,1); self.assertEqual(fake.calls,[])

    def test_port_failure_prevents_create(self):
        result,fake,_=self.execute(ports_error=RuntimeError('PORT_OCCUPIED'))
        self.assertEqual(result,1); self.assertFalse(any(c[0]=='create' for c in fake.calls))

    def test_existing_target_requires_explicit_resume(self):
        fake=FakeDocker(); fake.prepared()
        result,fake,_=self.execute(fake); self.assertEqual(result,1)
        self.assertFalse(any(c[0] in ('create','start') for c in fake.calls))

    def test_resume_rejects_missing_and_started_target(self):
        result,_,_=self.execute(resume_created=True); self.assertEqual(result,1)
        for field,value in (('Status','exited'),('Running',True)):
            fake=FakeDocker(); fake.prepared()['State'][field]=value
            result,_,_=self.execute(fake,resume_created=True); self.assertEqual(result,1)

    def test_start_and_health_failures_keep_maintenance(self):
        for failure in ('start',None):
            result,fake,text=self.execute(FakeDocker(failure),readiness=RuntimeError('BAD_HEALTH'))
            self.assertEqual(result,1); self.assertIn('FAILED_NEW_TARGET_STOPPED_RETAINED',text)
            self.assertFalse(fake.containers[m.NEW]['State']['Running'])
            self.assertEqual(fake.containers[m.NEW]['HostConfig']['RestartPolicy']['Name'],'no')

    def test_cleanup_failure_is_not_reported_as_stopped(self):
        result,fake,text=self.execute(FakeDocker('stop'),readiness=RuntimeError('BAD_HEALTH'))
        self.assertEqual(result,1); self.assertIn('FAILED_TARGET_STOP_NOT_CONFIRMED',text)
        self.assertTrue(fake.containers[m.NEW]['State']['Running'])

    def test_replaced_target_not_stopped(self):
        fake=FakeDocker()
        def replaced(_):
            fake.containers[m.NEW]['Id']='replacement'
            raise RuntimeError('REPLACED')
        result,fake,text=self.execute(fake,readiness=replaced)
        self.assertEqual(result,1); self.assertIn('FAILED_TARGET_STOP_NOT_CONFIRMED',text)
        self.assertFalse(any(c[0] in ('stop','update') for c in fake.calls))

    def test_keyboard_interrupt_stops_only_new(self):
        result,fake,text=self.execute(readiness=KeyboardInterrupt())
        self.assertEqual(result,1); self.assertIn('FAILED_NEW_TARGET_STOPPED_RETAINED',text)

    def test_environment_validation(self):
        for entries in (['A=1','A=2'],['BAD-KEY=x'],['A=x\ny'],['A=x\ry'],['A=x\0y'],['BROKEN']):
            with self.subTest(entries=entries):
                with self.assertRaises(RuntimeError): m.environment({'Env':entries})
        self.assertEqual(m.environment({'Env':['A=one=two three','EMPTY=']}),{'A':'one=two three','EMPTY':''})

    def test_host_normalization_is_narrow(self):
        self.assertEqual(m.host_differences({'OomKillDisable':None,'ConsoleSize':[41,81]}, {'OomKillDisable':False,'ConsoleSize':[0,0]}),[])
        self.assertEqual(m.host_differences({'OomKillDisable':True},{'OomKillDisable':False}),['OomKillDisable'])
        self.assertEqual(m.host_differences({'Privileged':None},{'Privileged':False}),['Privileged'])
        for bad in ('false',0,1):
            with self.assertRaises(RuntimeError): m.host_value('OomKillDisable',bad)

    def test_backup_age_boundaries(self):
        created=datetime.fromisoformat(m.CREATED_AT)
        m.check_backup_age(created); m.check_backup_age(created+timedelta(hours=24))
        for date in (created-timedelta(seconds=1),created+timedelta(hours=24,seconds=1)):
            with self.assertRaises(RuntimeError): m.check_backup_age(date)

    def test_openapi_requires_correct_methods(self):
        paths={path:{method:{}} for path,method in m.EXPECTED_PATHS.items()}
        paths.update({'/v1/auth/login':{'post':{}},'/v1/auth/me':{'get':{}},'/v1/projects':{'get':{}}})
        m.validate_openapi({'paths':paths})
        for path in paths:
            incomplete=copy.deepcopy(paths); incomplete[path]={}
            with self.assertRaises(RuntimeError): m.validate_openapi({'paths':incomplete})

    def test_wait_ready_three_healthy_reads_and_proxy(self):
        fake=FakeDocker(); target=fake.prepared(); target['State'].update(Running=True,Status='running')
        with mock.patch.object(m,'docker',fake), mock.patch.object(m,'http_json',return_value={'status':'ok'}) as http, \
             mock.patch.object(m,'validate_openapi') as api, mock.patch.object(m.time,'sleep'):
            m.wait_ready('new-id')
        self.assertEqual(sum(call.args[0]==m.BASE+'/health' for call in http.call_args_list),3)
        self.assertEqual(http.call_args_list[-1].args[0],m.PROXY_HEALTH); api.assert_called_once()


class FakePath:
    def __init__(self, text, data=b'', parent=None, mode=0o100600):
        self.text, self.data, self.parent, self.mode = text, data, parent, mode
    def __str__(self): return self.text
    def resolve(self): return self
    def is_dir(self): return True
    def stat(self): return SimpleNamespace(st_mode=self.mode)
    def lstat(self): return self.stat()
    def read_text(self, **kwargs): return self.data.decode('utf-8')
    def open(self, mode): return io.BytesIO(self.data)

class BackupReceiptTests(unittest.TestCase):
    def test_complete_receipt_and_hash_validation(self):
        self.run_validation()

    def run_validation(self, change=None):
        root=FakePath('/fixture',mode=0o40700)
        dump=FakePath('/fixture/backup.dump',b'database archive test bytes',root)
        roles=FakePath('/fixture/roles.sql',b'roles without passwords',root)
        dump_sha=m.hashlib.sha256(dump.data).hexdigest()
        roles_sha=m.hashlib.sha256(roles.data).hexdigest()
        data={'database':'ee_platform','system_identifier':'7686454253092706426',
              'created_at':m.CREATED_AT,'dump':str(dump),'sha256':dump_sha,
              'archive_list_validated':True,'restore_drill_done':False}
        receipt=FakePath('/fixture/receipt.json',parent=root)
        if change: change(root,dump,roles,receipt,data)
        receipt.data=json.dumps(data).encode('utf-8')
        with mock.patch.multiple(m,BACKUP_DIR=root,DUMP=dump,ROLES=roles,RECEIPT=receipt,
                                 DUMP_SHA=dump_sha,ROLES_SHA=roles_sha), contextlib.redirect_stdout(io.StringIO()):
            m.validate_backup(datetime.fromisoformat(m.CREATED_AT)+timedelta(hours=1))

    def test_wrong_metadata_refused(self):
        for key,value in (('database','other'),('system_identifier','other'),('dump','/other'),
                          ('sha256','bad'),('archive_list_validated',False),('restore_drill_done',True),
                          ('created_at','2000-01-01T00:00:00+00:00')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.run_validation(lambda root,dump,roles,receipt,data: data.update({key:value}))

    def test_dump_and_roles_hash_checked(self):
        with self.assertRaises(RuntimeError):
            self.run_validation(lambda root,dump,roles,receipt,data: setattr(dump,'data',b'tampered'))
        with self.assertRaises(RuntimeError):
            self.run_validation(lambda root,dump,roles,receipt,data: setattr(roles,'data',b'tampered'))

    def test_private_permissions_required(self):
        for index in range(4):
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                self.run_validation(lambda root,dump,roles,receipt,data: setattr((root,dump,roles,receipt)[index],
                    'mode',(root,dump,roles,receipt)[index].mode | 0o004))

    def test_symlink_and_wrong_parent_refused(self):
        with self.assertRaises(RuntimeError):
            self.run_validation(lambda root,dump,roles,receipt,data: setattr(dump,'mode',0o120600))
        with self.assertRaises(RuntimeError):
            self.run_validation(lambda root,dump,roles,receipt,data: setattr(dump,'parent',FakePath('/elsewhere')))

if __name__ == '__main__':
    unittest.main(verbosity=2)
