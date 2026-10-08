"""Local fixtures only: no real Docker, sudo, PostgreSQL or network."""
from pathlib import Path
from datetime import datetime
import hashlib,json,os,shutil,subprocess,sys
REPO=Path(__file__).resolve().parents[2]
SCRIPT=Path(__file__).with_name('maintenance-backup-workflows-r2.sh')
PACKAGE=REPO/'docs/current/database/m0-20260921-r2'
BASH=Path('D:/Program Files/Git/bin/bash.exe')
ROOT=REPO/'tmp'/('workflow-maintenance-backup-check-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
ROOT.mkdir(parents=True,exist_ok=False)
MOCK=ROOT/'mock_commands.py'
MOCK.write_text(r'''
import hashlib,json,os,sys
from pathlib import Path
f=Path(os.environ['FIXTURE_STATE'])
s=json.loads(f.read_text(encoding='utf-8'))
tool,*a=sys.argv[1:]; s['calls'].append([tool,*a]); code=0; out=''
if tool=='uname': out=s.get('os_name','Linux')
elif tool=='id': out='t7920'
elif tool=='docker':
    if a[0]=='inspect':
        key=a[-1]; c=next((v for k,v in s['containers'].items() if key in (k,v['id'])),None)
        if c is None: code=1
        else:
            fmt=a[a.index('--format')+1]
            if fmt=='{{.State.Running}}': out='true' if c['status']=='running' else 'false'
            elif fmt=='{{.Id}} {{.Image}} {{.State.Status}} {{.HostConfig.NetworkMode}}':
                out=f"{c['id']} {c['image']} {c['status']} host"
            else: code=97;out='FORBIDDEN_INSPECT'
    elif a[0]=='stop' and a[1:3]==['--timeout','60']:
        c=next((v for v in s['containers'].values() if a[-1]==v['id']),None)
        if c is None or a[-1]==s.get('stop_failure'): code=1
        else: c['status']='exited';out=c['id']
    else: code=97;out='FORBIDDEN_DOCKER_COMMAND'
elif tool=='sudo':
    if a==['-v']: code=1 if s.get('sudo_failure') else 0
    elif any(x.endswith('/pg_dumpall') for x in a):
        if '--roles-only' not in a or '--no-role-passwords' not in a: code=97;out='UNSAFE_ROLES_SNAPSHOT'
        elif s.get('roles_failure'): code=1
        else:
            out='-- local fixture roles without credentials'
            if s.get('backend_restarted'): list(s['containers'].values())[0]['status']='running'
    elif any(x.endswith('/psql') for x in a):
        sql=a[a.index('-c')+1]
        if not sql.startswith('SELECT ') or not any('default_transaction_read_only=on' in x for x in a):
            code=97;out='NON_READONLY_SQL'
        elif sql.startswith('SELECT current_database()'):
            out=s.get('target_facts','ee_platform|7686454253092706426|18|f')
        elif sql.startswith('SELECT count(*)'):
            s['client_reads']=s.get('client_reads',0)+1
            out=str(s.get('clients_before',0) if s['client_reads']==1 else s.get('clients_after',0))
        else: out='fixture_client | client_tool | idle | 1'
    else: code=97;out='FORBIDDEN_SUDO_COMMAND'
elif tool=='backup_helper':
    if a[:2]!=['server_step.py','backup']: code=97;out='FORBIDDEN_HELPER_STEP'
    elif s.get('backup_failure'): code=1;out='Fixture backup failed'
    else:
        root=Path(a[a.index('--backup-dir')+1]).resolve()
        dump=root/'fixture.dump'; dump.write_bytes(b'LOCAL BACKUP FIXTURE; NOT A POSTGRES ARCHIVE')
        receipt={'created_at':'2026-10-03T00:00:00+00:00','system_identifier':'7686454253092706426',
                 'database':'ee_platform','dump':str(dump),'sha256':hashlib.sha256(dump.read_bytes()).hexdigest(),
                 'archive_list_validated':True,'restore_drill_done':False}
        if s.get('corrupt_hash'): receipt['sha256']='0'*64
        if s.get('wrong_receipt_target'): receipt['database']='wrong_database'
        if s.get('bad_archive_flag'): receipt['archive_list_validated']=False
        if s.get('outside_dump'): receipt['dump']=str(root.parent/'not-created-outside.dump')
        rp=root/'fixture.backup.json'; rp.write_text(json.dumps(receipt),encoding='utf-8')
        if s.get('duplicate_receipt'): (root/'duplicate.backup.json').write_text(json.dumps(receipt),encoding='utf-8')
        out='BACKUP: '+str(dump)+'\nBACKUP_RECEIPT: '+str(rp)
else: code=97;out='FORBIDDEN_TOOL'
f.write_text(json.dumps(s),encoding='utf-8')
if out: print(out)
sys.exit(code)
''',encoding='utf-8')
MAIN='ts-agent-backend-20261002-project-role-r1'
PREVIEW='ts-agent-backend-console-20261002-r7'
MAIN_IMAGE='sha256:a6f0dc8ba3a05bfd68ceee0cd6ac23bd1e2811fdef8ac4c6e9aad8c265401517'
PREVIEW_IMAGE='sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5'

def case(name, *, config=None, fault=None, success=False, stop_calls=0, helper_calls=0):
    work=ROOT/name; work.mkdir()
    home=work/'home'; home.mkdir()
    package=work/'package'
    if fault!='missing-package': shutil.copytree(PACKAGE,package)
    if fault=='bad-manifest': (package/'SHA256SUMS').write_bytes(b'corrupt fixture')
    if fault=='changed-helper':
        with (package/'server_step.py').open('ab') as f: f.write(b'\n# changed fixture\n')
    state={'calls':[],'containers':{
        MAIN:{'id':'a'*64,'image':MAIN_IMAGE,'status':'running'},
        PREVIEW:{'id':'b'*64,'image':PREVIEW_IMAGE,'status':'running'}}}
    state.update(config or {})
    if fault=='wrong-image': state['containers'][MAIN]['image']='sha256:wrong'
    if fault=='already-stopped': state['containers'][PREVIEW]['status']='exited'
    sp=work/'state.json'; sp.write_text(json.dumps(state),encoding='utf-8')
    src=SCRIPT.read_text(encoding='utf-8')
    original='/data/ts-platform-managed/20260929/database-migrations/ts-db-m0-20260921-r2'
    assert src.count(original)==1
    src=src.replace(original,package.as_posix())
    python=Path(sys.executable).as_posix()
    mock=f'"{python}" "{MOCK.as_posix()}"'
    wrappers=f'''
docker() {{ {mock} docker "$@"; }}
sudo() {{ {mock} sudo "$@"; }}
uname() {{ {mock} uname "$@"; }}
id() {{ {mock} id "$@"; }}
python3() {{
  if [ "$1" = server_step.py ]; then {mock} backup_helper "$@";
  else "{python}" "$@"; fi
}}
test() {{
  if [[ "${{1:-}}" = -x && "${{2:-}}" = /usr/lib/postgresql/18/bin/* ]]; then return 0;
  else builtin test "$@"; fi
}}
'''
    driver=work/'driver.sh'; driver.write_bytes((wrappers+src).encode())
    env=dict(os.environ,HOME=home.as_posix(),FIXTURE_STATE=sp.as_posix())
    env.pop('BASH_ENV',None)
    env['PATH']=str(BASH.parent.parent/'usr/bin')+os.pathsep+env['PATH']
    result=subprocess.run([str(BASH),str(driver)],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=50)
    out=result.stdout+result.stderr; (work/'output.txt').write_text(out,encoding='utf-8')
    final=json.loads(sp.read_text(encoding='utf-8'))
    assert (result.returncode==0)==success,(name,out)
    assert ('BACKUP_STAGE_OK:' in out)==success,(name,out)
    calls=final['calls']
    stops=[c for c in calls if c[:2]==['docker','stop']]
    helpers=[c for c in calls if c[0]=='backup_helper']
    assert len(stops)==stop_calls,(name,stops,out)
    assert len(helpers)==helper_calls,(name,helpers,out)
    assert [c[-1] for c in stops]==['a'*64,'b'*64][:stop_calls],name
    assert all(c[1:3]==['server_step.py','backup'] for c in helpers),name
    assert all(c[1] in ('inspect','stop') for c in calls if c[0]=='docker'),name
    assert 'FORBIDDEN_' not in out and 'NON_READONLY_SQL' not in out and 'UNSAFE_ROLES' not in out,(name,out)
    if success:
        assert all(c['status']=='exited' for c in final['containers'].values())
        assert 'BACKUP_FILE_HASH_OK' in out
        assert 'restore_drill_done' in out and 'false' in out
        assert final['client_reads']==2
        assert len(list(home.glob('*/fixture.backup.json')))==1
    return {'case':name,'status':'PASS','stop_calls':len(stops),'backup_calls':len(helpers)}

syntax=subprocess.run([str(BASH),'-n',str(SCRIPT)],capture_output=True,text=True)
assert syntax.returncode==0,syntax.stderr
results=[
    case('success-only-approved-backends-stop',success=True,stop_calls=2,helper_calls=1),
    case('missing-backup-package',fault='missing-package'),
    case('wrong-manifest-hash',fault='bad-manifest'),
    case('changed-backup-helper',fault='changed-helper'),
    case('wrong-cluster',config={'target_facts':'ee_platform|wrong_cluster|18|f'}),
    case('wrong-old-image',fault='wrong-image'),
    case('already-stopped-container',fault='already-stopped'),
    case('sudo-fails-before-stop',config={'sudo_failure':True}),
    case('non-linux-refused',config={'os_name':'MINGW64_NT'}),
    case('other-clients-refused-no-termination',config={'clients_before':1},stop_calls=2),
    case('first-stop-fails',config={'stop_failure':'a'*64},stop_calls=1),
    case('second-stop-fails',config={'stop_failure':'b'*64},stop_calls=2),
    case('backup-helper-fails',config={'backup_failure':True},stop_calls=2,helper_calls=1),
    case('role-snapshot-fails',config={'roles_failure':True},stop_calls=2,helper_calls=1),
    case('backup-dump-hash-mismatch',config={'corrupt_hash':True},stop_calls=2,helper_calls=1),
    case('wrong-backup-receipt-target',config={'wrong_receipt_target':True},stop_calls=2,helper_calls=1),
    case('bad-archive-validation-flag',config={'bad_archive_flag':True},stop_calls=2,helper_calls=1),
    case('out-of-directory-dump-refused',config={'outside_dump':True},stop_calls=2,helper_calls=1),
    case('duplicate-receipt-refused',config={'duplicate_receipt':True},stop_calls=2,helper_calls=1),
    case('new-client-after-backup-refused',config={'clients_after':1},stop_calls=2,helper_calls=1),
    case('unexpected-backend-restart-refused',config={'backend_restarted':True},stop_calls=2,helper_calls=1),
]
report={'status':'PASS','bash_syntax':'PASS','script_sha256':hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
        'company_connected':False,'real_docker_executed':False,'real_database_backup_executed':False,
        'cases':results,'note':'Isolated local shell fixtures. Only frozen package hashing and receipt validation were real; Docker/sudo/DB/backup were mocked. No restore drill.'}
p=ROOT/'verification.json';p.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':'PASS','case_count':len(results),'evidence':str(p),'script_sha256':report['script_sha256']}))
