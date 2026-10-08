#!/usr/bin/env python3
# Company-user execution only. One migration, no frontend/preview/console cutover.
import argparse
import hashlib
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

PACKAGE = Path('/data/ts-platform-managed/20261003/workflows-r2/ts-db-agent-workflows-20261003-workflows-r2')
MANIFEST_SHA = '2f4fd6e395635106bde0045eab7cfba1c608c9ab97ac93feab179705cc67fecf'
HELPER = Path('/home/t7920/workflows-main-cutover-20261004-r1-incoming/cutover_main_workflows_20261004_r1.py')
HELPER_SHA = 'f9581695b96dd8d5f89f40347eb3d700fce513cc63e0437c9cb54c1d4bd4484e'
FILES = ('001_workflows.sql','apply.sql','combined-baseline.sql','init-project-presets.sql',
         'README.md','rollback-empty-only.sql','target.sql','verify.sql')
PSQL = '/usr/lib/postgresql/18/bin/psql'
SQL_TEMP_ROOT = Path('/tmp')

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def load_helper():
    require(not HELPER.is_symlink() and digest(HELPER.read_bytes()) == HELPER_SHA, 'REVIEWED_HELPER_HASH_MISMATCH')
    spec = importlib.util.spec_from_file_location('reviewed_main_cutover_helper', HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def package_bytes(root=PACKAGE):
    manifest = (root/'SHA256SUMS').read_bytes()
    require(digest(manifest) == MANIFEST_SHA, 'SQL_MANIFEST_HASH_MISMATCH')
    expected = {}
    for line in manifest.decode('utf-8').splitlines():
        sha, name = line.split('  ', 1)
        require(name in FILES and name not in expected, 'UNEXPECTED_SQL_MANIFEST_ENTRY')
        expected[name] = sha
    require(set(expected) == set(FILES), 'SQL_PAYLOAD_SET_MISMATCH')
    result = {'SHA256SUMS': manifest}
    for name in FILES:
        path = root/name
        require(not path.is_symlink() and path.is_file() and path.resolve().parent == root.resolve(), 'SQL_PATH_UNSAFE')
        data = path.read_bytes()
        require(digest(data) == expected[name], 'SQL_PAYLOAD_HASH_MISMATCH: ' + name)
        result[name] = data
    return result

def command(argv, log_dir, label, input_text=None, timeout=60):
    out_path = log_dir/(label+'.stdout.log')
    err_path = log_dir/(label+'.stderr.log')
    with out_path.open('xb') as stdout, err_path.open('xb') as stderr:
        try:
            result = subprocess.run(argv, input=None if input_text is None else input_text.encode('utf-8'),
                                    stdout=stdout, stderr=stderr, timeout=timeout, check=False)
        except (subprocess.TimeoutExpired, OSError) as error:
            raise RuntimeError('COMMAND_UNAVAILABLE_OR_TIMEOUT: '+label+'; inspect private logs') from error
    require(result.returncode == 0, 'COMMAND_FAILED: '+label+'; exit='+str(result.returncode)+'; inspect private logs')
    return out_path.read_text(encoding='utf-8', errors='replace')

def sql_command(readonly):
    options = '-c default_transaction_read_only='+('on' if readonly else 'off')
    options += ' -c statement_timeout=60000 -c lock_timeout=5000 -c client_min_messages=warning'
    return ['sudo','-n','-u','postgres','env','-i','PATH=/usr/lib/postgresql/18/bin:/usr/bin:/bin','LANG=C.UTF-8',
            'PGAPPNAME=ts-workflows-migration-20261004-r1','PGOPTIONS='+options,PSQL,
            '-X','-w','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','ee_platform',
            '-v','ON_ERROR_STOP=1','-v','expected_database=ee_platform',
            '-v','expected_system_id=7686454253092706426','-P','pager=off']

PREFLIGHT = '''
DO $guard$ BEGIN
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Read replica is not a migration target'; END IF;
 IF to_regclass('ee.chat_threads') IS NOT NULL OR to_regclass('ee.chat_turns') IS NOT NULL
    OR to_regprocedure('ee.accept_workflow_allocation(uuid,uuid,uuid,uuid,text)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM ee.permission_definitions WHERE code IN ('fr_allocation.create','fr_allocation.update','fr_allocation.accept'))
 THEN RAISE EXCEPTION 'Workflow schema/permissions already or partially present; inspect, never rerun blindly'; END IF;
 IF has_table_privilege('ee_project_api_rw','ee.fr_allocations','INSERT')
    OR has_table_privilege('ee_project_api_rw','ee.allocation_versions','INSERT')
    OR has_table_privilege('ee_project_api_rw','ee.allocation_targets','INSERT')
    OR has_column_privilege('ee_project_api_rw','ee.project_subsystem_designs','lock_version','UPDATE')
 THEN RAISE EXCEPTION 'Unexpected existing workflow write grants'; END IF;
END $guard$;
SELECT 'MIGRATION_PREFLIGHT_OK';
ROLLBACK;
'''
QUIET = '''
DO $guard$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM pg_stat_activity WHERE datname=current_database()
   AND backend_type='client backend' AND pid<>pg_backend_pid();
 IF n<>0 THEN RAISE EXCEPTION 'Other database clients remain: %. Close them; no sessions will be terminated.',n; END IF;
 IF pg_is_in_recovery() THEN RAISE EXCEPTION 'Unexpected recovery state'; END IF;
END $guard$;
SELECT 'DATABASE_QUIET_OK';
ROLLBACK;
'''

def readonly_sql(payload, body, log_dir, label, marker):
    sql = 'BEGIN READ ONLY;\n'+payload['target.sql'].decode('utf-8')+'\n'+body
    output = command(sql_command(True),log_dir,label,input_text=sql,timeout=120)
    require(marker in output, 'READONLY_MARKER_MISSING: '+label)

def stage_sql(payload, log_dir):
    stage = Path(tempfile.mkdtemp(prefix='ts-workflows-sql-20261004.', dir=SQL_TEMP_ROOT)).resolve()
    require(stage.parent == SQL_TEMP_ROOT.resolve() and stage.name.startswith('ts-workflows-sql-20261004.'), 'SQL_STAGE_PATH_UNSAFE')
    paths = []
    for name, data in payload.items():
        path = stage/name
        with path.open('xb') as file:
            file.write(data)
        path.chmod(0o600)
        paths.append(path)
    # Only reviewed SQL/manifest bytes, never env files or database dumps.
    # Give postgres direct access; do not rely on traversing private /data directories.
    command(['sudo','-n','chown','postgres:postgres',str(stage),*[str(p) for p in paths]],log_dir,'stage-owner')
    output = command(['sudo','-n','-u','postgres','sha256sum',*[str(p) for p in paths]],log_dir,'stage-hashes')
    received = {}
    for line in output.splitlines():
        sha, path = line.split('  ',1)
        received[path] = sha
    require(received == {str(stage/name):digest(data) for name,data in payload.items()}, 'STAGED_SQL_HASH_MISMATCH')
    return stage

def check_main(helper, old, identity=None, running=True):
    current = helper.inspect(helper.NEW)
    require(identity is None or current['Id'] == identity, 'COMPATIBLE_MAIN_ID_CHANGED')
    require(current['Image'] == helper.IMAGE_ID, 'COMPATIBLE_MAIN_IMAGE_CHANGED')
    helper.compare_configs(old,current)
    expected = 'running' if running else 'exited'
    require(current['State'].get('Status') == expected and current['State'].get('Running') is running
            and not current['State'].get('Restarting') and not current['State'].get('Dead')
            and not current['State'].get('Paused'), 'COMPATIBLE_MAIN_STATE_MISMATCH')
    return current['Id']

def write_state(log_dir, state):
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    (log_dir/'state.json').write_text(json.dumps(state,indent=2)+'\n',encoding='utf-8')


def migrate(check_only=False):
    os.umask(0o077)
    log_dir = Path(tempfile.mkdtemp(prefix='ts-workflows-migration-20261004.',dir=Path.home()))
    state = {'database':'ee_platform','system_identifier':'7686454253092706426',
             'phase':'preflight','apply_attempted':False,'apply_committed':False,
             'schema_verified':False,'main_stop_attempted':False,'main_start_attempted':False,
             'maintenance_active':True,'presets_initialized':False,'other_services_changed':False}
    helper = None
    identity = None
    print('MIGRATION_LOG_DIR='+str(log_dir),flush=True)
    try:
        write_state(log_dir,state)
        print('=== verify frozen SQL, backup and compatible backend ===',flush=True)
        helper = load_helper()
        payload = package_bytes()
        helper.validate_backup()
        require(Path(PSQL).is_file() and os.access(PSQL,os.X_OK),'PG18_PSQL_MISSING')
        command(['sudo','-n','true'],log_dir,'sudo-check')
        old, retained = helper.capture_sources()
        identity = check_main(helper,old)
        state['main_container_id'] = identity
        state['main_image_id'] = helper.IMAGE_ID
        state['backup_receipt'] = str(helper.RECEIPT)
        require(helper.http_json(helper.BASE+'/health').get('status') == 'ok','COMPATIBLE_MAIN_NOT_HEALTHY')
        helper.validate_openapi(helper.http_json(helper.BASE+'/openapi.json'))
        readonly_sql(payload,PREFLIGHT,log_dir,'preflight','MIGRATION_PREFLIGHT_OK')
        helper.recheck_sources(old,retained)
        check_main(helper,old,identity)
        print('MIGRATION_PREFLIGHT_OK: expected database/cluster, missing workflow schema, compatible backend',flush=True)
        if check_only:
            state['phase']='check_only_passed'
            write_state(log_dir,state)
            print('CHECK_ONLY_OK: private logs only; no service stop/start or database changes',flush=True)
            return 0
        sql_stage = stage_sql(payload,log_dir)
        state['sql_stage'] = str(sql_stage)
        helper.check_backup_age()
        check_main(helper,old,identity)
        helper.recheck_sources(old,retained)
        print('=== stop compatible main backend only; preview stays stopped ===',flush=True)
        state.update(phase='stopping_main',main_stop_attempted=True)
        write_state(log_dir,state)
        helper.docker('stop','--timeout','60',identity,timeout=75)
        check_main(helper,old,identity,running=False)
        helper.recheck_sources(old,retained)
        helper.require_free_ports()
        readonly_sql(payload,QUIET,log_dir,'quiet','DATABASE_QUIET_OK')
        print('DATABASE_QUIET_OK: no other target-database client sessions',flush=True)
        helper.check_backup_age()
        check_main(helper,old,identity,running=False)
        helper.recheck_sources(old,retained)
        state.update(phase='applying_sql',apply_attempted=True)
        write_state(log_dir,state)
        print('=== apply reviewed SQL in its own transaction ===',flush=True)
        output = command(sql_command(False)+['-f',str(sql_stage/'apply.sql')],log_dir,'apply',timeout=300)
        require('COMMIT' in output.splitlines(),'APPLY_COMMIT_MARKER_MISSING: outcome requires inspection')
        state.update(phase='verifying_sql',apply_committed=True)
        write_state(log_dir,state)
        print('SQL_APPLY_COMMITTED',flush=True)
        output = command(sql_command(True)+['-f',str(sql_stage/'verify.sql')],log_dir,'verify',timeout=300)
        require('WORKFLOW_SCHEMA_OK' in output and 'ROLLBACK' in output.splitlines(),'SCHEMA_VERIFY_MARKER_MISSING')
        state.update(phase='schema_verified',schema_verified=True)
        write_state(log_dir,state)
        print('WORKFLOW_SCHEMA_OK: combined baseline and minimum permissions verified',flush=True)
        # No presets or test rows, and no fallback to an incompatible old backend.
        helper.recheck_sources(old,retained)
        check_main(helper,old,identity,running=False)
        helper.require_free_ports()
        state.update(phase='starting_compatible_main',main_start_attempted=True)
        write_state(log_dir,state)
        print('=== start the same compatible main backend ===',flush=True)
        helper.docker('start',identity)
        helper.wait_ready(identity)
        check_main(helper,old,identity)
        helper.recheck_sources(old,retained)
        state.update(phase='completed',main_running_verified=True)
        write_state(log_dir,state)
        print('WORKFLOW_DB_MIGRATION_OK',flush=True)
        print('main_backend=healthy original_frontend_proxy=healthy schema=verified')
        print('preview=stopped old_main=stopped frontend_console=unchanged presets=not_initialized')
        print('KEEP_MAINTENANCE: new workflow/business and Agent acceptance still pending')
        print('MIGRATION_RECEIPT='+str(log_dir/'state.json'),flush=True)
        return 0
    except (Exception,KeyboardInterrupt) as error:
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        failed_phase = state['phase']
        state.update(phase='failed',failed_phase=failed_phase,error=message)
        print('WORKFLOW_MIGRATION_FAILED: phase='+failed_phase+'; '+message,flush=True)
        if state['main_start_attempted'] and helper is not None:
            for sig in (signal.SIGINT,signal.SIGTERM):
                signal.signal(sig,signal.SIG_IGN)
            try:
                current = helper.inspect(helper.NEW)
                require(current['Id']==identity and current['Image']==helper.IMAGE_ID,'REFUSE_TO_STOP_CHANGED_TARGET')
                helper.docker('update','--restart=no',identity)
                helper.docker('stop','--timeout','30',identity,timeout=45)
                require(not helper.inspect(identity)['State']['Running'],'FAILED_MAIN_STILL_RUNNING')
                state['failed_main_stopped']=True
                print('FAILED_MAIN_STOPPED_RETAINED: restart disabled; no old backend started',flush=True)
            except Exception:
                state['failed_main_stopped']=False
                print('FAILED_MAIN_STOP_NOT_CONFIRMED: report output; do not retry',flush=True)
        elif state['main_stop_attempted']:
            print('MAIN_STOP_ATTEMPTED: no automatic restart; inspect its actual state before further work',flush=True)
        else:
            print('NO_SERVICE_STOP_OR_DATABASE_APPLY_ATTEMPTED',flush=True)
        if state['apply_committed']:
            print('DATABASE_APPLY_COMMITTED: preserve schema/data; no automatic database rollback',flush=True)
        elif state['apply_attempted']:
            print('APPLY_RESULT_REQUIRES_INSPECTION: failure/timeout is NOT permission to rerun or roll back',flush=True)
        else:
            print('NO_DATABASE_APPLY_ATTEMPTED',flush=True)
        try:
            write_state(log_dir,state)
        except Exception:
            print('FAILED_TO_WRITE_FINAL_RECEIPT: existing protected logs retained',flush=True)
        print('STOP_HERE; KEEP_MAINTENANCE; no frontend/preview/console cutover',flush=True)
        print('MIGRATION_LOG_DIR='+str(log_dir),flush=True)
        return 1

def interrupted(signum,frame):
    raise KeyboardInterrupt()

if __name__ == '__main__':
    if not sys.platform.startswith('linux'):
        sys.exit('STOP: company Linux server only')
    signal.signal(signal.SIGINT,interrupted)
    signal.signal(signal.SIGTERM,interrupted)
    parser=argparse.ArgumentParser(description='Reviewed workflow SQL only; preserve maintenance and all other services')
    parser.add_argument('--check-only',action='store_true',help='Verify package/backup/main and readonly DB preconditions; no service or schema changes')
    args=parser.parse_args()
    sys.exit(migrate(check_only=args.check_only))
