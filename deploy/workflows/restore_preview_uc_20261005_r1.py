#!/usr/bin/env python3
'''User-executed restore of compatible, read-only 7018; no SQL or Agent call.'''
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, ProxyHandler, HTTPRedirectHandler, build_opener

MAIN = 'ts-agent-backend-20261003-workflows-r2'
FRONT = 'ts-agent-frontend-20261003-workflows-r2'
CONSOLE = 'ts-agent-console-20261002-r7'
OLD = 'ts-agent-backend-console-20261002-r7'
NEW = 'ts-agent-backend-console-20261003-workflows-r2'
IMAGE = 'ts-agent-backend:agent-console-20261003-workflows-r2'
IMAGE_ID = 'sha256:739175ad015c4ea0f39ce1b3665d088ae592488f37078f125010555ae6b2f48b'
MAIN_IMAGE = 'sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
OLD_IMAGE = 'sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5'
CONSOLE_IMAGE = 'sha256:21a8e77ff84148894800f367c0909e728289017e3a5c7250dd878242a4d83e3b'
PROJECT = 'bf8f4d08-d086-44bf-9cbe-f31abc67ee03'
FUNCTION = '3bb1333a-1ebf-428c-831f-c26dcd66cfa3'
CMD = ['python','-m','uvicorn','app.main:app','--host','127.0.0.1','--port','7018']
HEALTH = ['http://192.168.64.3:7000/health','http://192.168.64.3:7100/api/health','http://192.168.64.3:7200/health']

class Failure(Exception):
    pass

def require(condition, code):
    if not condition:
        raise Failure(code)

def docker(*args):
    try:
        p = subprocess.run(['docker',*args],capture_output=True,text=True,timeout=60)
    except (OSError,subprocess.TimeoutExpired):
        raise Failure('DOCKER_COMMAND_UNAVAILABLE_OR_TIMEOUT') from None
    require(p.returncode == 0,'DOCKER_COMMAND_FAILED_DETAILS_WITHHELD')
    return p.stdout.strip()

def inspect(name):
    return json.loads(docker('inspect',name))[0]

def environment(obj):
    result = {}
    for line in obj['Config'].get('Env') or []:
        key,sep,value = line.partition('=')
        require(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',key) and key not in result,'INVALID_ENVIRONMENT_KEY')
        require(not any(chr(c) in value for c in (0,10,13)),'MULTILINE_ENVIRONMENT_UNSUPPORTED')
        result[key] = value
    return result

def protected_fingerprint(obj):
    data = {k:obj.get(k) for k in ('Id','Image','Config','HostConfig','Mounts')}
    data['running'] = obj['State']['Running']
    data['started'] = obj['State'].get('StartedAt')
    return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

def host_config_equal(a,b):
    a,b = dict(a),dict(b)
    for x in (a,b):
        x.pop('ConsoleSize',None)
        value = x.get('OomKillDisable')
        require(value is None or type(value) is bool,'INVALID_OOM_SETTING')
        if value is None:
            x['OomKillDisable'] = False
    return a == b

def private_environment(main,old,console):
    env,oldenv,lab = environment(main),environment(old),environment(console)
    require(oldenv.get('BUSINESS_WRITES_ENABLED','').lower() == 'false','OLD_PREVIEW_NOT_READ_ONLY')
    require(lab.get('LAB_DEMO_MODE','').lower() == 'false','CONSOLE_NOT_LIVE_MODE')
    require(lab.get('LAB_BACKEND_URL','').rstrip('/') == 'http://127.0.0.1:7018','CONSOLE_BACKEND_URL_MISMATCH')
    require(lab.get('LAB_ALLOWED_PROJECTS') == PROJECT and lab.get('LAB_PRESET_PROJECT_ID') == PROJECT,'CONSOLE_PROJECT_SCOPE_MISMATCH')
    require(lab.get('LAB_PRESET_FUNCTION_ID') == FUNCTION,'CONSOLE_FUNCTION_SCOPE_MISMATCH')
    require(env.get('AGENT_CALLBACK_KEY') and env['AGENT_CALLBACK_KEY'] == lab.get('LAB_CALLBACK_KEY'),'CALLBACK_KEY_MISMATCH_OR_MISSING')
    require(lab.get('LAB_TRACE_KEY') and lab['LAB_TRACE_KEY'] == oldenv.get('DIAGNOSTICS_KEY'),'DIAGNOSTIC_KEY_MISMATCH_OR_MISSING')
    for key in ('SECRET_KEY','PROJECTS_DATABASE_URL','AGENT_API_KEY'):
        require(bool(env.get(key)),'MAIN_REQUIRED_SETTING_MISSING')
    require(bool(env.get('AGENT_GENERATION_INVOKE_URL') or env.get('AGENT_INVOKE_URL')),'MAIN_AGENT_URL_MISSING')
    env.update(BUSINESS_WRITES_ENABLED='false',DIAGNOSTICS_ENABLED='true',DIAGNOSTICS_KEY=lab['LAB_TRACE_KEY'],DIAGNOSTICS_PROJECT_IDS=PROJECT)
    return env

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,newurl):
        return None

def get_json(url,headers=None):
    try:
        with build_opener(ProxyHandler({}),NoRedirect()).open(Request(url,headers=headers or {}),timeout=5) as response:
            raw = response.read(200001)
            require(len(raw) <= 200000,'HTTP_RESPONSE_TOO_LARGE')
            return json.loads(raw)
    except Failure:
        raise
    except Exception:
        raise Failure('HTTP_CHECK_FAILED') from None

def check_services():
    for url in HEALTH:
        require(get_json(url).get('status') == 'ok','EXISTING_SERVICE_NOT_HEALTHY')

def port_free():
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1',7018))
        except OSError:
            raise Failure('PORT_7018_NOT_FREE') from None

def source_snapshot():
    sources = {name:inspect(name) for name in (MAIN,FRONT,CONSOLE,OLD)}
    for name in (MAIN,FRONT,CONSOLE):
        require(sources[name]['State']['Running'],'REQUIRED_SOURCE_NOT_RUNNING')
    old = sources[OLD]
    require(old['State']['Status'] == 'exited' and not old['State']['Running'],'OLD_PREVIEW_MUST_REMAIN_STOPPED')
    require(sources[MAIN]['Image'] == MAIN_IMAGE and old['Image'] == OLD_IMAGE,'BACKEND_BASELINE_IMAGE_MISMATCH')
    require(sources[CONSOLE]['Image'] == CONSOLE_IMAGE,'CONSOLE_BASELINE_IMAGE_MISMATCH')
    require(old['HostConfig']['NetworkMode'] == 'host','OLD_PREVIEW_NETWORK_MISMATCH')
    require(old['HostConfig']['RestartPolicy'] == {'Name':'unless-stopped','MaximumRetryCount':0},'OLD_PREVIEW_RESTART_POLICY_MISMATCH')
    require(not old.get('Mounts') and not old['Config'].get('Volumes'),'UNEXPECTED_PREVIEW_MOUNTS')
    require(old['Config'].get('WorkingDir') == '/app' and old['Config'].get('User','') == '','UNEXPECTED_PREVIEW_RUNTIME')
    require(not old['Config'].get('Entrypoint') and not old['Config'].get('Tty') and not old['Config'].get('OpenStdin'),'UNEXPECTED_PREVIEW_ENTRYPOINT_OR_TTY')
    require(not old['Config'].get('Labels'),'UNEXPECTED_PREVIEW_LABELS')
    return sources

def recheck_sources(sources):
    for name,obj in sources.items():
        require(protected_fingerprint(inspect(obj['Id'])) == protected_fingerprint(obj),'SOURCE_CHANGED_DURING_RESTORE')

def verify_target(target,old,env):
    require(target['Image'] == IMAGE_ID,'TARGET_IMAGE_MISMATCH')
    require(environment(target) == env,'TARGET_ENVIRONMENT_MISMATCH')
    require(host_config_equal(old['HostConfig'],target['HostConfig']),'TARGET_HOST_CONFIG_MISMATCH')
    require(not target.get('Mounts') and not target['Config'].get('Volumes'),'TARGET_MOUNT_MISMATCH')
    require(target['Config'].get('Cmd') == CMD and not target['Config'].get('Entrypoint'),'TARGET_COMMAND_MISMATCH')
    require(target['Config'].get('WorkingDir') == '/app' and target['Config'].get('User','') == '','TARGET_RUNTIME_MISMATCH')
    require(not target['Config'].get('Tty') and not target['Config'].get('OpenStdin'),'TARGET_TTY_MISMATCH')
    require(not target['Config'].get('Healthcheck'),'TARGET_HEALTHCHECK_MISMATCH')

def restore(check_only=False,resume_created=False):
    new_id = None
    started = False
    try:
        print('=== read-only preview restore preflight ===',flush=True)
        sources = source_snapshot()
        env = private_environment(sources[MAIN],sources[OLD],sources[CONSOLE])
        image = json.loads(docker('image','inspect',IMAGE))[0]
        require(image['Id'] == IMAGE_ID,'PREVIEW_IMAGE_TAG_MISMATCH')
        require(not image['Config'].get('Entrypoint') and not image['Config'].get('Volumes'),'UNEXPECTED_IMAGE_DEFAULTS')
        exists = NEW in docker('ps','-a','--format','{{.Names}}').splitlines()
        if exists:
            require(resume_created,'TARGET_EXISTS_USE_REVIEWED_RESUME_ONLY')
            candidate = inspect(NEW)
            require(candidate['State']['Status'] == 'created','RESUME_TARGET_NOT_CREATED')
            verify_target(candidate,sources[OLD],env)
        else:
            require(not resume_created,'RESUME_TARGET_MISSING')
        check_services()
        port_free()
        recheck_sources(sources)
        if check_only:
            print('CHECK_ONLY_OK: no container changes, SQL or Agent calls; values withheld')
            return 0
        if exists:
            new_id = candidate['Id']
        else:
            print('=== create compatible preview; preserve secrets privately ===',flush=True)
            with tempfile.TemporaryDirectory(prefix='ts-preview-env-') as directory:
                os.chmod(directory,0o700)
                envfile = Path(directory)/'runtime.env'
                fd = os.open(envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'w',encoding='utf-8',newline=chr(10)) as stream:
                    stream.write(chr(10).join(k+'='+v for k,v in env.items())+chr(10))
                new_id = docker('create','--name',NEW,'--network','host','--restart','unless-stopped','--workdir','/app','--env-file',str(envfile),'--pull','never',IMAGE_ID,*CMD)
        verify_target(inspect(new_id),sources[OLD],env)
        recheck_sources(sources)
        port_free()
        print('CONFIG_MATCH_OK: fresh main config, original console keys, writes=false',flush=True)
        started = True
        docker('start',new_id)
        for attempt in range(45):
            require(inspect(new_id)['State']['Running'],'NEW_PREVIEW_EXITED')
            try:
                if get_json('http://127.0.0.1:7018/health').get('status') == 'ok':
                    break
            except Failure:
                pass
            time.sleep(1)
        else:
            raise Failure('PREVIEW_HEALTH_TIMEOUT')
        verify_target(inspect(new_id),sources[OLD],env)
        probe = 'from app.core.config import settings; assert settings.business_writes_enabled is False; assert settings.diagnostics_enabled is True; assert settings.diagnostics_project_ids == ['+repr(PROJECT)+']; print(chr(79)+chr(75))'
        require(docker('exec',new_id,'python','-B','-c',probe) == 'OK','RUNTIME_POLICY_CHECK_FAILED')
        template = get_json('http://127.0.0.1:7018/v1/agent/uc-template?scene=FROM_PRD_CREATE_UC',{'X-Agent-Internal-Key':env['AGENT_CALLBACK_KEY']})
        require(template.get('scene') == 'FROM_PRD_CREATE_UC' and len(template.get('fields',[])) == 12,'PREVIEW_TEMPLATE_CHECK_FAILED')
        check_services()
        recheck_sources(sources)
        print('PREVIEW_BACKEND_RESTORED')
        print('container='+NEW+' listen=127.0.0.1:7018 business_writes=false')
        print('main7000=OK frontend7100=OK console7200=OK; console and old preview unchanged')
        print('NO_SQL_NO_BUILD_NO_AGENT_CALLS; browser UC generation/diagram acceptance pending')
        return 0
    except BaseException as error:
        print('RESTORE_FAILED: '+(str(error) if isinstance(error,Failure) else type(error).__name__))
        if new_id and started:
            try:
                docker('update','--restart=no',new_id)
                docker('stop','--timeout','20',new_id)
                print('NEW_PREVIEW_STOPPED_RETAINED: original services not stopped by this script')
            except Failure:
                print('NEW_PREVIEW_STOP_FAILED: inspect manually; do not touch main services')
        elif new_id:
            print('CREATED_TARGET_RETAINED_STOPPED: no service was started')
        return 1

def main():
    if not sys.platform.startswith('linux'):
        print('STOP: run only on the approved Ubuntu server')
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only',action='store_true')
    parser.add_argument('--resume-created',action='store_true')
    args = parser.parse_args()
    return restore(args.check_only,args.resume_created)

if __name__ == '__main__':
    sys.exit(main())
