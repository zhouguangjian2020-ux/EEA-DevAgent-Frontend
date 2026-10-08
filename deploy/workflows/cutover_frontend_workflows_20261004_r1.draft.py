#!/usr/bin/env python3
# Company-user frontend-only cutover. No SQL, build, backend or console mutations.
import argparse
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

def require(ok,message):
    if not ok:
        raise RuntimeError(message)

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
    for key in ('Entrypoint','Cmd','WorkingDir','User','Healthcheck','StopSignal','StopTimeout',
                'Tty','OpenStdin','ExposedPorts','Volumes','Labels','Domainname'):
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
        ready=item['State'].get('Running') and frontend_healthy(h)
        count=count+1 if ready else 0
        if count>=3:
            return
        time.sleep(2)
    raise RuntimeError('FRONTEND_READINESS_TIMEOUT')

if __name__ == '__main__':
    raise SystemExit('INCOMPLETE_DRAFT: not approved for deployment; no service action performed')
