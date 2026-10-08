import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import unittest
from unittest.mock import patch

P = Path(__file__).with_name('restore_preview_uc_20261005_r1.py')
spec = importlib.util.spec_from_file_location('restore_preview_tested',P)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
CALLBACK = 'fixture-callback-secret-never-print'
TRACE = 'fixture-diagnostics-secret-never-print'

def container(name,image,env,running=True):
    return {'Id':name+'-id','Name':'/'+name,'Image':image,
            'Config':{'Env':[k+'='+v for k,v in env.items()],'Cmd':r.CMD,'Entrypoint':None,'WorkingDir':'/app','User':'','Labels':{},'Volumes':None,'Tty':False,'OpenStdin':False},
            'HostConfig':{'NetworkMode':'host','RestartPolicy':{'Name':'unless-stopped','MaximumRetryCount':0},'ConsoleSize':[41,81],'OomKillDisable':None,'Memory':0},
            'Mounts':[],'State':{'Running':running,'Status':'running' if running else 'exited','StartedAt':'baseline'}}

def fixtures():
    env={'SECRET_KEY':'fixture-session-secret','AGENT_CALLBACK_KEY':CALLBACK,'PROJECTS_DATABASE_URL':'fixture-db-url','AGENT_API_KEY':'fixture-agent-secret','AGENT_INVOKE_URL':'http://agent.invalid/invoke','BUSINESS_WRITES_ENABLED':'true'}
    oldenv=dict(env,BUSINESS_WRITES_ENABLED='false',DIAGNOSTICS_KEY=TRACE)
    lab={'LAB_DEMO_MODE':'false','LAB_BACKEND_URL':'http://127.0.0.1:7018','LAB_ALLOWED_PROJECTS':r.PROJECT,'LAB_PRESET_PROJECT_ID':r.PROJECT,'LAB_PRESET_FUNCTION_ID':r.FUNCTION,'LAB_CALLBACK_KEY':CALLBACK,'LAB_TRACE_KEY':TRACE}
    return {r.MAIN:container(r.MAIN,r.MAIN_IMAGE,env),r.FRONT:container(r.FRONT,'frontend-image',{}),r.CONSOLE:container(r.CONSOLE,r.CONSOLE_IMAGE,lab),r.OLD:container(r.OLD,r.OLD_IMAGE,oldenv,False)}

class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.sources=fixtures()

    def desired_env(self):
        return r.private_environment(self.sources[r.MAIN],self.sources[r.OLD],self.sources[r.CONSOLE])

    def change_env(self,name,key,value):
        env=r.environment(self.sources[name]); env[key]=value
        self.sources[name]['Config']['Env']=[k+'='+v for k,v in env.items()]

    def test_environment_uses_main_and_retains_console_keys_without_writes(self):
        self.change_env(r.MAIN,'NEW_MAIN_SETTING','fresh')
        env=self.desired_env()
        self.assertEqual(env['NEW_MAIN_SETTING'],'fresh')
        self.assertEqual(env['BUSINESS_WRITES_ENABLED'],'false')
        self.assertEqual(env['DIAGNOSTICS_ENABLED'],'true')
        self.assertEqual(env['DIAGNOSTICS_PROJECT_IDS'],r.PROJECT)
        self.assertEqual(env['DIAGNOSTICS_KEY'],TRACE)
        self.assertEqual(env['AGENT_CALLBACK_KEY'],CALLBACK)
        self.assertEqual(r.environment(self.sources[r.MAIN])['BUSINESS_WRITES_ENABLED'],'true')

    def test_rejects_mismatched_keys_and_scope(self):
        for key in ('LAB_CALLBACK_KEY','LAB_TRACE_KEY','LAB_BACKEND_URL','LAB_ALLOWED_PROJECTS','LAB_PRESET_PROJECT_ID','LAB_PRESET_FUNCTION_ID','LAB_DEMO_MODE'):
            with self.subTest(key=key):
                self.sources=fixtures(); self.change_env(r.CONSOLE,key,'incorrect')
                with self.assertRaises(r.Failure): self.desired_env()

    def test_rejects_writable_old_preview(self):
        self.change_env(r.OLD,'BUSINESS_WRITES_ENABLED','true')
        with self.assertRaises(r.Failure): self.desired_env()

    def test_rejects_multiline_or_duplicate_environment(self):
        obj=self.sources[r.MAIN]
        obj['Config']['Env'].append('INVALID=value'+chr(10)+'oops')
        with self.assertRaises(r.Failure): r.environment(obj)
        obj['Config']['Env']=['A=1','A=2']
        with self.assertRaises(r.Failure): r.environment(obj)

    def test_oom_null_false_and_console_size_only_are_equivalent(self):
        a=self.sources[r.OLD]['HostConfig']; b=dict(a,OomKillDisable=False,ConsoleSize=[0,0])
        self.assertTrue(r.host_config_equal(a,b))
        self.assertFalse(r.host_config_equal(a,dict(b,OomKillDisable=True)))
        self.assertFalse(r.host_config_equal(a,dict(b,Memory=1)))
        for bad in (0,1,'false'):
            with self.assertRaises(r.Failure): r.host_config_equal(a,dict(b,OomKillDisable=bad))

    def exercise(self,*,check_only=False,resume=False,existing=None,fail_template=False,fail_config=False,fail_start=False):
        before=copy.deepcopy(self.sources); env=self.desired_env(); calls=[]; target=None; env_paths=[]
        if existing:
            target=container(r.NEW,r.IMAGE_ID,env,existing=='running')
            target['State']['Status']=existing
        def lookup(name):
            if name in (r.NEW,r.NEW+'-id') and target: return copy.deepcopy(target)
            for k,v in self.sources.items():
                if name in (k,v['Id']): return copy.deepcopy(v)
            raise AssertionError('Unexpected inspect target')
        def command(*args):
            nonlocal target
            calls.append(args)
            if args[:2]==('image','inspect'): return json.dumps([{'Id':r.IMAGE_ID,'Config':{'Entrypoint':None,'Volumes':None}}])
            if args[:2]==('ps','-a'): return r.NEW if target else ''
            if args[0]=='create':
                self.assertIn(r.IMAGE_ID,args); self.assertNotIn(r.IMAGE,args)
                ep=Path(args[args.index('--env-file')+1]); env_paths.append(ep)
                # POSIX mode is guaranteed by os.open(0600), Windows only models contents.
                if os.name!='nt': self.assertEqual(stat.S_IMODE(ep.stat().st_mode),0o600)
                values=dict(line.split('=',1) for line in ep.read_text().splitlines())
                self.assertEqual(values,env)
                target=container(r.NEW,r.IMAGE_ID,values,False); target['State']['Status']='created'
                target['HostConfig'].update(OomKillDisable=False,ConsoleSize=[0,0])
                if fail_config: target['HostConfig']['Memory']=123
                return target['Id']
            if args[0]=='start':
                self.assertEqual(args[1],target['Id'])
                if fail_start: raise r.Failure('SIMULATED_START_FAILURE')
                target['State'].update(Running=True,Status='running'); return target['Id']
            if args[0]=='exec':
                self.assertEqual(args[1],target['Id']); return 'OK'
            if args[0]=='update':
                self.assertEqual(args,('update','--restart=no',target['Id'])); return target['Id']
            if args[0]=='stop':
                self.assertEqual(args[-1],target['Id']); target['State'].update(Running=False,Status='exited'); return target['Id']
            raise AssertionError('Unexpected docker operation')
        def http(url,headers=None):
            if '/uc-template' in url:
                self.assertEqual(headers,{'X-Agent-Internal-Key':CALLBACK})
                if fail_template: raise r.Failure('SIMULATED_TEMPLATE_FAILURE')
                return {'scene':'FROM_PRD_CREATE_UC','fields':[{}]*12}
            return {'status':'ok'}
        out=io.StringIO()
        with patch.object(r,'inspect',side_effect=lookup),patch.object(r,'docker',side_effect=command),patch.object(r,'get_json',side_effect=http),patch.object(r,'port_free'),patch.object(r.time,'sleep'),contextlib.redirect_stdout(out):
            code=r.restore(check_only,resume)
        self.assertEqual(self.sources,before)
        self.assertNotIn(CALLBACK,out.getvalue()); self.assertNotIn(TRACE,out.getvalue())
        for ep in env_paths: self.assertFalse(ep.exists())
        return code,calls,out.getvalue()

    def test_check_only_never_creates_starts_or_executes_container(self):
        code,calls,out=self.exercise(check_only=True)
        self.assertEqual(code,0); self.assertIn('CHECK_ONLY_OK',out)
        self.assertTrue(all(a[0] in ('image','ps') for a in calls))

    def test_success_creates_and_starts_only_new_preview(self):
        code,calls,out=self.exercise()
        self.assertEqual(code,0); self.assertIn('PREVIEW_BACKEND_RESTORED',out)
        self.assertEqual([a[0] for a in calls],['image','ps','create','start','exec'])

    def test_resume_created_does_not_create_again(self):
        code,calls,out=self.exercise(resume=True,existing='created')
        self.assertEqual(code,0); self.assertNotIn('create',[a[0] for a in calls])

    def test_existing_running_target_is_not_touched(self):
        code,calls,out=self.exercise(resume=True,existing='running')
        self.assertEqual(code,1); self.assertIn('RESUME_TARGET_NOT_CREATED',out)
        self.assertTrue(all(a[0] in ('image','ps') for a in calls))

    def test_existing_target_requires_explicit_resume(self):
        code,calls,out=self.exercise(existing='created')
        self.assertEqual(code,1); self.assertIn('TARGET_EXISTS',out)
        self.assertTrue(all(a[0] in ('image','ps') for a in calls))

    def test_config_failure_retains_created_container_without_start(self):
        code,calls,out=self.exercise(fail_config=True)
        self.assertEqual(code,1); self.assertIn('CREATED_TARGET_RETAINED_STOPPED',out)
        self.assertNotIn('start',[a[0] for a in calls])

    def test_runtime_failure_disables_restart_and_stops_only_new_preview(self):
        code,calls,out=self.exercise(fail_template=True)
        self.assertEqual(code,1); self.assertIn('NEW_PREVIEW_STOPPED_RETAINED',out)
        self.assertEqual([a[0] for a in calls][-2:],['update','stop'])

    def test_start_failure_cleanup_never_starts_old_container(self):
        code,calls,out=self.exercise(fail_start=True)
        self.assertEqual(code,1); self.assertEqual([a[0] for a in calls][-2:],['update','stop'])

    def test_windows_entrypoint_does_not_contact_docker(self):
        with patch.object(r.sys,'platform','win32'),patch.object(r,'docker') as d,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main(),2); d.assert_not_called()

    def test_http_redirects_are_not_followed(self):
        self.assertIsNone(r.NoRedirect().redirect_request(None,None,302,'redirect',{},'http://outside.invalid'))

    def test_running_old_preview_fails_preflight_without_mutations(self):
        self.sources[r.OLD]['State'].update(Running=True,Status='running')
        with patch.object(r,'inspect',side_effect=lambda name:self.sources[name]):
            with self.assertRaisesRegex(r.Failure,'OLD_PREVIEW_MUST_REMAIN_STOPPED'):
                r.source_snapshot()

    def test_configured_healthcheck_is_not_silently_introduced(self):
        target=container(r.NEW,r.IMAGE_ID,self.desired_env(),False)
        target['Config']['Healthcheck']={'Test':['CMD','unexpected']}
        with self.assertRaisesRegex(r.Failure,'TARGET_HEALTHCHECK_MISMATCH'):
            r.verify_target(target,self.sources[r.OLD],self.desired_env())

    def test_protected_service_change_is_detected(self):
        altered=copy.deepcopy(self.sources[r.MAIN]); altered['State']['StartedAt']='changed'
        with patch.object(r,'inspect',return_value=altered):
            with self.assertRaisesRegex(r.Failure,'SOURCE_CHANGED_DURING_RESTORE'):
                r.recheck_sources({r.MAIN:self.sources[r.MAIN]})
if __name__=='__main__': unittest.main()
