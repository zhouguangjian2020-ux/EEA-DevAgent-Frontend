#!/usr/bin/env python3
# User-run main backend cutover only; no SQL/build/old-container restart.
import argparse
import errno
import hashlib
import json
import os
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OLD = 'ts-agent-backend-20261002-project-role-r1'
OLD_ID = 'a7f35ad870f152bd9c9404a7c6781e9e769392c4611c3c036c8a4770060d87ed'
OLD_IMAGE_ID = 'sha256:a6f0dc8ba3a05bfd68ceee0cd6ac23bd1e2811fdef8ac4c6e9aad8c265401517'
PREVIEW = 'ts-agent-backend-console-20261002-r7'
PREVIEW_ID = 'da6f95a2f87a8c39e0546b42b4ebf12ac1599d0a0097ac1156d231adeea4cf83'
PREVIEW_IMAGE_ID = 'sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5'
NEW = 'ts-agent-backend-20261003-workflows-r2'
IMAGE = 'ts-agent-backend:20261003-workflows-r2'
IMAGE_ID = 'sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
UNCHANGED = {
    'ts-agent-frontend-20261002-project-context-r1': 'sha256:e7dab5cc351ba5a670363a7ade59ee8874d4dc03fd8a12c838c5ef02624675b7',
    'ts-agent-console-20261002-r7': 'sha256:21a8e77ff84148894800f367c0909e728289017e3a5c7250dd878242a4d83e3b',
}
BASE = 'http://192.168.64.3:7000'
PROXY_HEALTH = 'http://192.168.64.3:7100/api/health'
CMD = ['python', '-m', 'uvicorn', 'app.main:app', '--host', '192.168.64.3', '--port', '7000']
BACKUP_DIR = Path('/home/t7920/ts-workflows-backup-20261003.tvDLYK')
DUMP = BACKUP_DIR / 'ee_platform-20261004T002542643195Z.dump'
RECEIPT = BACKUP_DIR / 'ee_platform-20261004T002542643195Z.backup.json'
DUMP_SHA = '4a0115df63b706f4d4d953eadc24866386a89a73f035b34e8f9699d4f242b5ab'
ROLES = BACKUP_DIR / 'roles-before-no-passwords.sql'
ROLES_SHA = '387bb135e0aefe3b6f60992d76f6e1b6608873053bc04551a161adacd541cfcf'
CREATED_AT = '2026-10-04T00:25:42.742490+00:00'
EXPECTED_PATHS = {
    '/v1/projects/{project_id}/functions/{function_id}/fr-generations': 'post',
    '/v1/projects/{project_id}/functions/{function_id}/fr-candidates/adopt': 'post',
    '/v1/projects/{project_id}/functions/{function_id}/allocation-generations': 'post',
    '/v1/projects/{project_id}/functions/{function_id}/allocations': 'post',
    '/v1/projects/{project_id}/allocations/{allocation_id}/accept': 'post',
    '/v1/projects/{project_id}/conversations': 'get',
    '/v1/projects/{project_id}/conversations/{thread_id}': 'get',
    '/v1/projects/{project_id}/conversations/{thread_id}/messages/stream': 'post',
}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def docker(*args, timeout=30):
    try:
        result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('DOCKER_UNAVAILABLE_OR_TIMEOUT: ' + args[0]) from error
    require(result.returncode == 0, 'DOCKER_FAILED: ' + args[0] + '; stderr withheld')
    return result.stdout

def inspect(name):
    return json.loads(docker('inspect', name))[0]

def environment(config):
    env = {}
    for item in config.get('Env') or []:
        key, sep, value = item.partition('=')
        require(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key), 'INVALID_ENV_ENTRY')
        require(key not in env, 'DUPLICATE_ENV_NAME')
        require(not any(chr(c) in item for c in (0, 10, 13)), 'MULTILINE_ENV_UNSUPPORTED')
        env[key] = value
    return env

def host_value(key, value):
    if key == 'OomKillDisable':
        require(value is None or type(value) is bool, 'INVALID_OOM_TYPE')
        return False if value is None else value
    return value

def host_differences(a, b):
    return [key for key in sorted(set(a) | set(b)) if key != 'ConsoleSize'
            and host_value(key, a.get(key)) != host_value(key, b.get(key))]

def require_stopped(container, identity, image):
    state = container['State']
    require(container['Id'] == identity and container['Image'] == image, 'SOURCE_IDENTITY_MISMATCH')
    require(state.get('Status') == 'exited' and not state.get('Running')
            and not state.get('Paused') and not state.get('Restarting')
            and not state.get('Dead'), 'MAINTENANCE_SOURCE_NOT_STOPPED')

def require_prepared(container):
    state = container['State']
    require(state.get('Status') == 'created' and not state.get('Running')
            and not state.get('Paused') and not state.get('Restarting')
            and not state.get('Dead') and container.get('RestartCount', 0) == 0,
            'TARGET_MUST_BE_NEVER_STARTED_CREATED')

def compare_configs(old, new):
    require(new['Image'] == IMAGE_ID, 'TARGET_IMAGE_MISMATCH')
    require(environment(old['Config']) == environment(new['Config']), 'ENV_MISMATCH: values withheld')
    for key in ('Entrypoint', 'Cmd', 'WorkingDir', 'User', 'Healthcheck', 'StopSignal', 'StopTimeout',
                'Tty', 'OpenStdin', 'StdinOnce', 'ExposedPorts', 'Volumes', 'Labels', 'Domainname',
                'AttachStdin', 'AttachStdout', 'AttachStderr', 'NetworkDisabled', 'OnBuild', 'Shell', 'ArgsEscaped'):
        require(old['Config'].get(key) == new['Config'].get(key), 'CONFIG_MISMATCH: ' + key)
    differences = host_differences(old['HostConfig'], new['HostConfig'])
    require(not differences, 'HOST_CONFIG_MISMATCH: ' + ','.join(differences))
    require(not new.get('Mounts'), 'UNEXPECTED_TARGET_MOUNTS')

def check_backup_age(now=None):
    age = ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(CREATED_AT)).total_seconds()
    require(0 <= age <= 24 * 3600, 'BACKUP_OUTSIDE_24H_WINDOW: stop and request reviewed rebackup; do not bypass')

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def validate_backup(now=None):
    check_backup_age(now)
    require(BACKUP_DIR.resolve() == BACKUP_DIR and BACKUP_DIR.is_dir(), 'BACKUP_DIRECTORY_CHANGED')
    require(BACKUP_DIR.stat().st_mode & 0o077 == 0, 'BACKUP_DIRECTORY_NOT_PRIVATE')
    for path in (RECEIPT, DUMP, ROLES):
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and path.resolve().parent == BACKUP_DIR, 'BACKUP_PATH_UNSAFE')
        require(info.st_mode & 0o077 == 0, 'BACKUP_FILE_NOT_PRIVATE')
    receipt = json.loads(RECEIPT.read_text(encoding='utf-8'))
    require(receipt.get('created_at') == CREATED_AT and receipt.get('database') == 'ee_platform'
            and receipt.get('system_identifier') == '7686454253092706426', 'BACKUP_IDENTITY_MISMATCH')
    require(receipt.get('dump') == str(DUMP) and receipt.get('sha256') == DUMP_SHA, 'BACKUP_RECEIPT_MISMATCH')
    require(receipt.get('archive_list_validated') is True and receipt.get('restore_drill_done') is False,
            'BACKUP_RECEIPT_FLAGS_CHANGED')
    require(sha256(DUMP) == DUMP_SHA and sha256(ROLES) == ROLES_SHA, 'BACKUP_FILE_HASH_MISMATCH')
    print('BACKUP_IDENTITY_HASH_AGE_OK; restore_drill_done=false', flush=True)

def require_free_ports():
    for host, port in (('192.168.64.3', 7000), ('127.0.0.1', 7018)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(2)
            result = sock.connect_ex((host, port))
        require(result == errno.ECONNREFUSED, 'MAINTENANCE_PORT_NOT_CONFIRMED_FREE: ' + str(port))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def http_json(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=3) as response:
        require(response.status == 200, 'HTTP_STATUS_NOT_200')
        body = response.read(2 * 1024 * 1024 + 1)
        require(len(body) <= 2 * 1024 * 1024, 'HTTP_RESPONSE_TOO_LARGE')
        return json.loads(body)

def validate_openapi(document):
    paths = document.get('paths', {})
    for path, method in EXPECTED_PATHS.items():
        require(method in paths.get(path, {}), 'WORKFLOW_ROUTE_MISSING: ' + method.upper() + ' ' + path)
    for path, method in (('/v1/auth/login', 'post'), ('/v1/auth/me', 'get'), ('/v1/projects', 'get')):
        require(method in paths.get(path, {}), 'LEGACY_ROUTE_MISSING: ' + path)

def wait_ready(identity):
    deadline = time.monotonic() + 60
    consecutive = 0
    while time.monotonic() < deadline:
        current = inspect(NEW)
        require(current['Id'] == identity and current['Image'] == IMAGE_ID, 'STARTED_TARGET_IDENTITY_CHANGED')
        try:
            ready = current['State']['Running'] and http_json(BASE + '/health').get('status') == 'ok'
        except Exception:
            ready = False
        consecutive = consecutive + 1 if ready else 0
        if consecutive >= 3:
            validate_openapi(http_json(BASE + '/openapi.json'))
            require(http_json(PROXY_HEALTH).get('status') == 'ok', 'ORIGINAL_FRONTEND_PROXY_NOT_HEALTHY')
            return
        time.sleep(2)
    raise RuntimeError('MAIN_BACKEND_HEALTH_TIMEOUT')


def capture_sources():
    old = inspect(OLD)
    preview = inspect(PREVIEW)
    require_stopped(old, OLD_ID, OLD_IMAGE_ID)
    require_stopped(preview, PREVIEW_ID, PREVIEW_IMAGE_ID)
    require(old['HostConfig']['NetworkMode'] == 'host', 'SOURCE_NETWORK_NOT_HOST')
    require(old['HostConfig']['RestartPolicy'] == {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
            'SOURCE_RESTART_POLICY_CHANGED')
    require(not old.get('Mounts'), 'SOURCE_MOUNTS_REQUIRE_REVIEW')
    require(old['Config'].get('Entrypoint') is None and old['Config'].get('Cmd') == CMD
            and old['Config'].get('WorkingDir') == '/app' and old['Config'].get('User') == '', 'SOURCE_STARTUP_CHANGED')
    env = environment(old['Config'])
    require(env.get('BUSINESS_WRITES_ENABLED', '').lower() == 'true' and env.get('APP_ENV') == 'production',
            'SOURCE_WRITE_OR_ENV_POLICY_CHANGED')
    for key in ('PROJECTS_DATABASE_URL', 'PROJECTS_WRITE_DATABASE_URL', 'AGENT_INVOKE_URL',
                'AGENT_GENERATION_INVOKE_URL', 'AGENT_API_KEY', 'AGENT_CALLBACK_KEY'):
        require(bool(env.get(key)), 'SOURCE_REQUIRED_CONFIG_MISSING: ' + key)
    require(environment(preview['Config']).get('BUSINESS_WRITES_ENABLED', '').lower() == 'false',
            'PREVIEW_WRITE_POLICY_CHANGED')
    retained = {PREVIEW: preview}
    for name, image in UNCHANGED.items():
        item = inspect(name)
        require(item['Image'] == image and item['State'].get('Running'), 'RETAINED_SERVICE_CHANGED: ' + name)
        retained[name] = item
    return old, retained

def recheck_sources(old, retained):
    current = inspect(OLD)
    require_stopped(current, OLD_ID, OLD_IMAGE_ID)
    require(current['Config'] == old['Config'] and current['HostConfig'] == old['HostConfig']
            and current.get('Mounts') == old.get('Mounts'), 'SOURCE_CONFIG_CHANGED_DURING_PREPARATION')
    for name, before in retained.items():
        after = inspect(name)
        require(after['Id'] == before['Id'] and after['Image'] == before['Image']
                and after['Config'] == before['Config'] and after['HostConfig'] == before['HostConfig']
                and after.get('Mounts') == before.get('Mounts')
                and after['State'].get('Running') == before['State'].get('Running')
                and after['State'].get('Status') == before['State'].get('Status'), 'RETAINED_SERVICE_CHANGED: ' + name)
    require_stopped(inspect(PREVIEW), PREVIEW_ID, PREVIEW_IMAGE_ID)

def deploy(check_only=False, resume_created=False):
    start_attempted = False
    new_id = None
    try:
        os.umask(0o077)
        print('=== maintenance main-backend preflight ===', flush=True)
        validate_backup()
        old, retained = capture_sources()
        require_free_ports()
        require(json.loads(docker('image', 'inspect', IMAGE))[0]['Id'] == IMAGE_ID, 'IMAGE_TAG_CHANGED')
        names = docker('ps', '-a', '--format', '{{.Names}}').splitlines()
        if resume_created:
            require(NEW in names, 'NO_CREATED_TARGET_TO_RESUME')
            target = inspect(NEW)
            require_prepared(target)
            compare_configs(old, target)
        else:
            require(NEW not in names, 'TARGET_EXISTS: retain it; only reviewed --resume-created may continue')
        if check_only:
            recheck_sources(old, retained)
            print('CHECK_ONLY_OK: no container creation/start/stop/update; no SQL', flush=True)
            return 0
        if not resume_created:
            print('=== create stopped target; preserve runtime environment privately ===', flush=True)
            env = environment(old['Config'])
            with tempfile.TemporaryDirectory(prefix='ts-main-workflows-') as directory:
                env_file = Path(directory) / 'runtime.env'
                env_file.write_bytes(('\n'.join(key + '=' + value for key, value in env.items()) + '\n').encode('utf-8'))
                env_file.chmod(0o600)
                docker('create', '--name', NEW, '--network', 'host', '--restart', 'unless-stopped',
                       '--workdir', '/app', '--env-file', str(env_file), '--pull', 'never', IMAGE_ID, *CMD)
        target = inspect(NEW)
        require_prepared(target)
        compare_configs(old, target)
        new_id = target['Id']
        recheck_sources(old, retained)
        require_free_ports()
        check_backup_age()
        target = inspect(NEW)
        require(target['Id'] == new_id, 'TARGET_ID_CHANGED_BEFORE_START')
        require_prepared(target)
        compare_configs(old, target)
        print('CONFIG_MATCH_OK: environment values withheld; OOM null/false equivalent; ConsoleSize ignored', flush=True)
        print('=== start compatible main backend only; maintenance remains active ===', flush=True)
        start_attempted = True
        docker('start', new_id)
        wait_ready(new_id)
        recheck_sources(old, retained)
        final_target = inspect(NEW)
        require(final_target['Id'] == new_id and final_target['State'].get('Running')
                and final_target['State'].get('Status') == 'running'
                and final_target.get('RestartCount', 0) == 0, 'FINAL_TARGET_NOT_STABLE')
        compare_configs(old, final_target)
        print('MAIN_BACKEND_CUTOVER_OK', flush=True)
        print('container=' + NEW + '\nimage=' + IMAGE + '\nimage_id=' + IMAGE_ID)
        print('health=OK openapi_workflow_routes=8 original_frontend_proxy=OK')
        print('old_main=retained_stopped preview=retained_stopped frontend_console=unchanged')
        print('NO_SQL_APPLIED; KEEP_MAINTENANCE; auth/read-only acceptance still required')
        return 0
    except (Exception, KeyboardInterrupt) as error:
        # Do not output Docker stderr, environment, DSNs or arbitrary exception text.
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        print('MAIN_BACKEND_STAGE_FAILED: ' + message, flush=True)
        if start_attempted:
            for sig in (signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, signal.SIG_IGN)
            try:
                failed = inspect(NEW)
                require(failed['Id'] == new_id and failed['Image'] == IMAGE_ID, 'TARGET_CHANGED_REFUSE_CLEANUP')
                docker('update', '--restart=no', new_id)
                docker('stop', '--timeout', '30', new_id, timeout=45)
                require(not inspect(new_id)['State']['Running'], 'FAILED_TARGET_STILL_RUNNING')
                print('FAILED_NEW_TARGET_STOPPED_RETAINED: restart disabled; old services NOT restarted', flush=True)
            except Exception:
                print('FAILED_TARGET_STOP_NOT_CONFIRMED: retain all containers; report output; no further deployment', flush=True)
        else:
            print('NO_START_PERFORMED: any created target retained; old backends NOT restarted', flush=True)
        print('MAINTENANCE_NOT_RELEASED; no SQL executed by this script', flush=True)
        return 1

def interrupted(signum, frame):
    raise KeyboardInterrupt()

if __name__ == '__main__':
    if not sys.platform.startswith('linux'):
        sys.exit('STOP: company Linux server only; do not run on Windows')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(description='Compatible main backend only; no SQL; keep maintenance active')
    parser.add_argument('--check-only', action='store_true', help='No mutation; validate maintained source and backup')
    parser.add_argument('--resume-created', action='store_true', help='Explicitly reuse only a verified never-started target')
    args = parser.parse_args()
    sys.exit(deploy(check_only=args.check_only, resume_created=args.resume_created))
