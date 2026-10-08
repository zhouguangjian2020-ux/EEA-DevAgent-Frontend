#!/usr/bin/env python3
# Company-user frontend-only cutover. No SQL, build, backend or console mutations.
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import signal
import stat
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

OLD = 'ts-agent-frontend-20261002-project-context-r1'
OLD_IMAGE_ID = 'sha256:e7dab5cc351ba5a670363a7ade59ee8874d4dc03fd8a12c838c5ef02624675b7'
NEW = 'ts-agent-frontend-20261003-workflows-r2'
IMAGE = 'ts-agent-frontend:20261003-workflows-r2'
IMAGE_ID = 'sha256:5564af68ba15be2ac89f7871ea5705c7bac40dbddcd8026023e34fc8e06cece0'
MAIN = 'ts-agent-backend-20261003-workflows-r2'
MAIN_IMAGE_ID = 'sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
BASE = 'http://192.168.64.3:7100'
CMD = ['./node_modules/.bin/next','start','-H','0.0.0.0','-p','7100']
HELPER = Path('/home/t7920/workflows-main-cutover-20261004-r1-incoming/cutover_main_workflows_20261004_r1.py')
HELPER_SHA = 'f9581695b96dd8d5f89f40347eb3d700fce513cc63e0437c9cb54c1d4bd4484e'
MIGRATION_RECEIPT = Path('/home/t7920/ts-workflows-migration-20261004.zbg34iel/state.json')
RETAINED = {
    MAIN: (MAIN_IMAGE_ID,True),
    'ts-agent-backend-20261002-project-role-r1': ('sha256:a6f0dc8ba3a05bfd68ceee0cd6ac23bd1e2811fdef8ac4c6e9aad8c265401517',False),
    'ts-agent-backend-console-20261002-r7': ('sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5',False),
    'ts-agent-console-20261002-r7': ('sha256:21a8e77ff84148894800f367c0909e728289017e3a5c7250dd878242a4d83e3b',True),
}

class CutoverError(RuntimeError):
    pass

def require(ok,message):
    if not ok:
        raise CutoverError(message)

def load_helper():
    require(not HELPER.is_symlink() and hashlib.sha256(HELPER.read_bytes()).hexdigest()==HELPER_SHA,
            'REVIEWED_HELPER_HASH_MISMATCH')
    spec=importlib.util.spec_from_file_location('reviewed_main_cutover_helper',HELPER)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def validate_migration_receipt():
    require(MIGRATION_RECEIPT.resolve()==MIGRATION_RECEIPT, 'MIGRATION_RECEIPT_PATH_CHANGED')
    info=MIGRATION_RECEIPT.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_mode & 0o077 == 0, 'MIGRATION_RECEIPT_NOT_PRIVATE_REGULAR_FILE')
    require(MIGRATION_RECEIPT.parent.stat().st_mode & 0o077 == 0,'MIGRATION_RECEIPT_DIRECTORY_NOT_PRIVATE')
    r=json.loads(MIGRATION_RECEIPT.read_text(encoding='utf-8'))
    require(r.get('phase')=='completed' and r.get('database')=='ee_platform'
            and r.get('system_identifier')=='7686454253092706426','MIGRATION_RECEIPT_NOT_COMPLETED_FOR_TARGET')
    for key in ('apply_attempted','apply_committed','schema_verified','main_running_verified'):
        require(r.get(key) is True,'MIGRATION_RECEIPT_FLAG_NOT_TRUE: '+key)
    require(r.get('main_image_id')==MAIN_IMAGE_ID and re.fullmatch('[0-9a-f]{64}',r.get('main_container_id','')) is not None,
            'MIGRATION_MAIN_IDENTITY_MISMATCH')
    require(not r.get('error'),'MIGRATION_RECEIPT_HAS_ERROR')
    require(r.get('maintenance_active') is True and r.get('presets_initialized') is False
            and r.get('other_services_changed') is False,'MIGRATION_RECEIPT_SCOPE_CHANGED')
    return r

def valid_state(item,running):
    state=item['State']
    require(state.get('Running') is running and state.get('Status')==('running' if running else 'exited')
            and not state.get('Paused') and not state.get('Dead') and not state.get('Restarting'),
            'CONTAINER_STATE_MISMATCH')

def capture_retained(h,receipt):
    saved={}
    for name,(image,running) in RETAINED.items():
        item=h.inspect(name)
        require(item['Image']==image,'RETAINED_IMAGE_MISMATCH: '+name)
        valid_state(item,running)
        saved[name]=item
    require(saved[MAIN]['Id']==receipt['main_container_id'],'MIGRATION_MAIN_CONTAINER_REPLACED')
    require(saved[h.OLD]['Id']==h.OLD_ID and saved[h.PREVIEW]['Id']==h.PREVIEW_ID,'RETAINED_OLD_CONTAINER_ID_CHANGED')
    require(h.environment(saved[h.PREVIEW]['Config']).get('BUSINESS_WRITES_ENABLED','').lower()=='false',
            'PREVIEW_WRITE_POLICY_CHANGED')
    require(h.environment(saved[MAIN]['Config']).get('BUSINESS_WRITES_ENABLED','').lower()=='true',
            'MAIN_WRITE_POLICY_CHANGED')
    return saved

def recheck_retained(h,saved):
    for name,before in saved.items():
        after=h.inspect(name)
        for key in ('Id','Image','Config','HostConfig','Mounts','RestartCount'):
            require(after.get(key)==before.get(key),'RETAINED_SERVICE_CHANGED: '+name+'; '+key)
        for key in ('Running','Status','Paused','Dead','Restarting','StartedAt','FinishedAt'):
            require(after['State'].get(key)==before['State'].get(key),'RETAINED_SERVICE_STATE_CHANGED: '+name)

def validate_source(h,old):
    require(old['Image']==OLD_IMAGE_ID,'SOURCE_FRONTEND_IMAGE_MISMATCH')
    valid_state(old,True)
    require(not old.get('Mounts'),'SOURCE_FRONTEND_MOUNTS_REQUIRE_REVIEW')
    require(old['HostConfig']['NetworkMode']=='host'
            and old['HostConfig']['RestartPolicy']=={'Name':'unless-stopped','MaximumRetryCount':0},
            'SOURCE_FRONTEND_NETWORK_OR_RESTART_CHANGED')
    config=old['Config']
    require(config.get('WorkingDir')=='/app' and config.get('User')==''
            and config.get('Cmd')==CMD and config.get('Entrypoint')==['docker-entrypoint.sh'],
            'SOURCE_FRONTEND_STARTUP_CHANGED')
    require(h.environment(config).get('BACKEND_URL')=='http://192.168.64.3:7000','SOURCE_BACKEND_TARGET_CHANGED')

def same_source(h,before,running=True):
    current=h.inspect(OLD)
    require(current['Id']==before['Id'] and current['Image']==OLD_IMAGE_ID,'SOURCE_FRONTEND_ID_CHANGED')
    valid_state(current,running)
    for key in ('Config','HostConfig','Mounts'):
        require(current.get(key)==before.get(key),'SOURCE_FRONTEND_CONFIG_CHANGED: '+key)
    return current

def compare_target(h,old,target):
    require(target['Image']==IMAGE_ID,'TARGET_FRONTEND_IMAGE_MISMATCH')
    require(h.environment(old['Config'])==h.environment(target['Config']),'FRONTEND_ENV_MISMATCH: values withheld')
    for key in sorted((set(old['Config']) | set(target['Config'])) - {'Env','Image','Hostname'}):
        require(old['Config'].get(key)==target['Config'].get(key),'FRONTEND_CONFIG_MISMATCH: '+key)
    differences=h.host_differences(old['HostConfig'],target['HostConfig'])
    require(not differences,'FRONTEND_HOST_CONFIG_MISMATCH: '+','.join(differences))
    require(not target.get('Mounts'),'UNEXPECTED_FRONTEND_MOUNT')

def frontend_healthy(h):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),h.NoRedirect())
    try:
        for path in ('/','/login'):
            with opener.open(BASE+path,timeout=3) as response:
                if response.status!=200:
                    return False
        return h.http_json(BASE+'/api/health').get('status')=='ok'
    except Exception:
        return False

def wait_frontend(h,name,identity,image):
    deadline=time.monotonic()+60
    count=0
    while time.monotonic()<deadline:
        item=h.inspect(name)
        require(item['Id']==identity and item['Image']==image,'FRONTEND_IDENTITY_CHANGED_DURING_READINESS')
        state=item['State']
        ready=(state.get('Running') is True and state.get('Status')=='running'
               and not state.get('Paused') and not state.get('Restarting') and not state.get('Dead')
               and item.get('RestartCount',0)==0 and frontend_healthy(h))
        count=count+1 if ready else 0
        if count>=3:
            return
        time.sleep(2)
    raise CutoverError('FRONTEND_READINESS_TIMEOUT')

def verify_image(h):
    image=json.loads(h.docker('image','inspect',IMAGE))[0]
    require(image.get('Id')==IMAGE_ID,'TARGET_FRONTEND_TAG_CHANGED')
    config=image.get('Config',{})
    require(config.get('Entrypoint')==['docker-entrypoint.sh'] and config.get('Cmd')==CMD
            and config.get('WorkingDir')=='/app' and config.get('User','')=='',
            'TARGET_IMAGE_STARTUP_CHANGED')

def verify_services(h):
    require(h.http_json('http://192.168.64.3:7000/health').get('status')=='ok','MAIN_HEALTH_NOT_OK')
    h.validate_openapi(h.http_json('http://192.168.64.3:7000/openapi.json'))
    require(h.http_json('http://192.168.64.3:7200/health').get('status')=='ok','CONSOLE_HEALTH_NOT_OK')

def target_exists(h):
    return NEW in h.docker('ps','-a','--format','{{.Names}}').splitlines()

def source_before_stop(h,old):
    current=same_source(h,old)
    require(current.get('RestartCount')==old.get('RestartCount')
            and current['State'].get('StartedAt')==old['State'].get('StartedAt'),
            'SOURCE_FRONTEND_RESTARTED_DURING_PREFLIGHT')

def validate_candidate(h,old,identity=None):
    candidate=h.inspect(NEW)
    require(re.fullmatch('[0-9a-f]{64}',candidate.get('Id','')) is not None,'TARGET_CONTAINER_ID_INVALID')
    if identity is not None:
        require(candidate['Id']==identity,'TARGET_CONTAINER_REPLACED')
    h.require_prepared(candidate)
    require(candidate['State'].get('StartedAt','0001-01-01T00:00:00Z').startswith('0001-01-01'),
            'TARGET_HAS_PREVIOUS_START_TIME')
    compare_target(h,old,candidate)
    return candidate

def create_candidate(h,old):
    env=h.environment(old['Config'])
    with tempfile.TemporaryDirectory(prefix='ts-frontend-env-') as directory:
        os.chmod(directory,0o700)
        path=Path(directory)/'runtime.env'
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as stream:
            for key,value in env.items():
                stream.write(key+'='+value+'\n')
        result=h.docker('create','--name',NEW,'--network','host','--restart','unless-stopped',
                        '--workdir','/app','--env-file',str(path),'--pull','never',IMAGE_ID,*CMD).strip()
        require(re.fullmatch('[0-9a-f]{64}',result) is not None,'CREATE_DID_NOT_RETURN_FULL_ID')
        return result

def mutate_frontend(h,verb,identity,old_id,new_id):
    # Only captured frontend IDs may be mutated; old restart policy never changes.
    require(old_id!=new_id and re.fullmatch('[0-9a-f]{64}',identity) is not None,
            'INVALID_FRONTEND_MUTATION_ID')
    require(identity in (old_id,new_id),'NON_FRONTEND_MUTATION_REFUSED')
    if verb=='disable-restart':
        require(identity==new_id,'OLD_FRONTEND_POLICY_UPDATE_REFUSED')
        return h.docker('update','--restart=no',identity)
    if verb=='stop':
        return h.docker('stop','--timeout','30',identity,timeout=45)
    if verb=='start':
        return h.docker('start',identity)
    raise CutoverError('UNSUPPORTED_FRONTEND_MUTATION')

@contextlib.contextmanager
def recovery_signals():
    previous={s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
    try:
        for s in previous:
            signal.signal(s,signal.SIG_IGN)
        yield
    finally:
        for s,handler in previous.items():
            signal.signal(s,handler)

def rollback_frontend(h,old,new_id,retained):
    failed=h.inspect(NEW)
    require(failed['Id']==new_id,'TARGET_CHANGED_REFUSE_RECOVERY')
    compare_target(h,old,failed)
    mutate_frontend(h,'disable-restart',new_id,old['Id'],new_id)
    failed=h.inspect(NEW)
    require(failed['Id']==new_id and failed['Image']==IMAGE_ID,'TARGET_CHANGED_DURING_RECOVERY')
    if failed['State'].get('Running') or failed['State'].get('Restarting'):
        mutate_frontend(h,'stop',new_id,old['Id'],new_id)
    failed=h.inspect(NEW)
    require(failed['Id']==new_id and failed['Image']==IMAGE_ID and not failed['State'].get('Running')
            and not failed['State'].get('Restarting') and failed['HostConfig']['RestartPolicy']['Name']=='no',
            'FAILED_FRONTEND_NOT_SAFELY_STOPPED')
    require(failed['State'].get('Status') in ('created','exited'),'FAILED_FRONTEND_UNEXPECTED_STATE')
    recheck_retained(h,retained)
    current=h.inspect(OLD)
    require(current['Id']==old['Id'],'SOURCE_FRONTEND_CHANGED_REFUSE_RECOVERY')
    for key in ('Image','Config','HostConfig','Mounts'):
        require(current.get(key)==old.get(key),'SOURCE_CHANGED_REFUSE_RECOVERY: '+key)
    state=current['State']
    require(not state.get('Paused') and not state.get('Dead') and not state.get('Restarting'),
            'SOURCE_STATE_UNSAFE_FOR_RECOVERY')
    if state.get('Running') is not True:
        valid_state(current,False)
        mutate_frontend(h,'start',old['Id'],old['Id'],new_id)
    wait_frontend(h,OLD,old['Id'],OLD_IMAGE_ID)
    same_source(h,old)
    recheck_retained(h,retained)
    verify_services(h)
    print('FRONTEND_ROLLBACK_OK: old frontend healthy; new frontend stopped; restart disabled; both retained',flush=True)

def safe_reason(error):
    if type(error) is CutoverError:
        return str(error)
    if type(error) is RuntimeError and str(error) in {
            'INVALID_ENV_ENTRY','DUPLICATE_ENV_NAME','MULTILINE_ENV_UNSUPPORTED',
            'INVALID_OOM_TYPE','TARGET_MUST_BE_NEVER_STARTED_CREATED'}:
        return str(error)
    if type(error) is RuntimeError and re.fullmatch(
            r'DOCKER_(?:FAILED|UNAVAILABLE_OR_TIMEOUT): (?:inspect|image|ps|create|update|start|stop)(?:; stderr withheld)?',str(error)):
        return str(error)
    return type(error).__name__

def deploy(check_only=False,resume_created=False):
    stop_attempted=False
    old=None
    new_id=None
    h=None
    retained=None
    previous_umask=os.umask(0o077)
    try:
        print('=== frontend-only cutover preflight ===',flush=True)
        h=load_helper()
        receipt=validate_migration_receipt()
        retained=capture_retained(h,receipt)
        old=h.inspect(OLD)
        require(re.fullmatch('[0-9a-f]{64}',old.get('Id','')) is not None,'SOURCE_CONTAINER_ID_INVALID')
        validate_source(h,old)
        require(old.get('RestartCount',0)==0,'SOURCE_FRONTEND_RESTART_HISTORY_REQUIRES_REVIEW')
        verify_image(h)
        verify_services(h)
        require(frontend_healthy(h),'OLD_FRONTEND_NOT_HEALTHY')
        exists=target_exists(h)
        if exists:
            require(resume_created,'TARGET_EXISTS_USE_REVIEWED_RESUME_CREATED')
            new_id=validate_candidate(h,old)['Id']
        else:
            require(not resume_created,'RESUME_TARGET_MISSING')
        source_before_stop(h,old)
        recheck_retained(h,retained)
        if check_only:
            print('CHECK_ONLY_OK: no container creation/start/stop/update; no SQL or image build',flush=True)
            return 0
        if not exists:
            print('=== create stopped frontend; preserve actual environment privately ===',flush=True)
            new_id=create_candidate(h,old)
        validate_candidate(h,old,new_id)
        verify_image(h)
        verify_services(h)
        require(frontend_healthy(h),'OLD_FRONTEND_NOT_HEALTHY_BEFORE_STOP')
        source_before_stop(h,old)
        recheck_retained(h,retained)
        validate_candidate(h,old,new_id)
        print('CONFIG_MATCH_OK: environment values withheld; OOM null/false equivalent; ConsoleSize ignored',flush=True)
        print('=== stop old frontend and start new frontend only ===',flush=True)
        stop_attempted=True
        mutate_frontend(h,'stop',old['Id'],old['Id'],new_id)
        same_source(h,old,running=False)
        recheck_retained(h,retained)
        validate_candidate(h,old,new_id)
        mutate_frontend(h,'start',new_id,old['Id'],new_id)
        wait_frontend(h,NEW,new_id,IMAGE_ID)
        final=h.inspect(NEW)
        require(final['Id']==new_id and final.get('RestartCount',0)==0,'TARGET_NOT_STABLE')
        valid_state(final,True)
        compare_target(h,old,final)
        same_source(h,old,running=False)
        recheck_retained(h,retained)
        verify_services(h)
        print('FRONTEND_WORKFLOWS_CUTOVER_OK',flush=True)
        print('container='+NEW+'\nimage='+IMAGE+'\nimage_id='+IMAGE_ID)
        print('root=OK login=OK proxy_health=OK openapi_workflow_routes=8 old_frontend=retained_stopped')
        print('main_backend=unchanged old_backend=stopped preview=stopped console=unchanged')
        print('NO_SQL_NO_BUILD_NO_PRESETS; KEEP_MAINTENANCE; browser/business/Agent acceptance pending')
        return 0
    except (Exception,KeyboardInterrupt) as error:
        print('FRONTEND_STAGE_FAILED: '+safe_reason(error),flush=True)
        if stop_attempted:
            with recovery_signals():
                try:
                    rollback_frontend(h,old,new_id,retained)
                except (Exception,KeyboardInterrupt) as recovery_error:
                    print('FRONTEND_ROLLBACK_NOT_CONFIRMED: '+safe_reason(recovery_error),flush=True)
                    print('STOP: preserve all containers and return this output; do not rerun blindly',flush=True)
        else:
            print('NO_CUTOVER: old frontend not stopped by this script; any created target retained',flush=True)
        print('KEEP_MAINTENANCE: no SQL, backend or console mutation was issued',flush=True)
        return 1
    finally:
        os.umask(previous_umask)

def interrupted(signum,frame):
    raise KeyboardInterrupt()

def main():
    if not sys.platform.startswith('linux'):
        print('STOP: company Linux server only; do not run this script on Windows')
        return 2
    parser=argparse.ArgumentParser(description='Main frontend only; retain compatible backend/schema and maintenance')
    parser.add_argument('--check-only',action='store_true')
    parser.add_argument('--resume-created',action='store_true',help='Explicitly reuse only a verified never-started target')
    args=parser.parse_args()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,interrupted)
    # Serialize this helper locally without modifying service configuration.
    import fcntl
    lock=Path.home()/'.ts-frontend-workflows-20261004-r2.lock'
    fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid()
                and info.st_mode & 0o077==0,'UNSAFE_LOCK_FILE')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return deploy(check_only=args.check_only,resume_created=args.resume_created)
    except (OSError,CutoverError):
        print('STOP: exclusive private deployment lock unavailable; no service action started')
        return 1
    finally:
        os.close(fd)

if __name__=='__main__':
    sys.exit(main())
