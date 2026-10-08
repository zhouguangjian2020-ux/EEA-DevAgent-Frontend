#!/usr/bin/env python3
"""Manual Ubuntu steps for the existing R2 sample; no SSH, service/config changes or table DDL."""
import argparse
import getpass
import hashlib
import importlib.util
import os
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
FILES = frozenset(['001_prepare.sql','002_reader_role.sql','verify_data.sql','verify_reader.sql','verify_db_reader.sql','project_read_step.py'])


def check_package():
    raw=(BASE/'SHA256SUMS').read_bytes()
    if b'\r' in raw or raw.startswith(b'\xef\xbb\xbf'): raise RuntimeError('Manifest must be LF without BOM')
    seen=set()
    for line in raw.decode().splitlines():
        sha,name=line.split('  ',1)
        if name not in FILES or name in seen: raise RuntimeError('Unexpected/duplicate payload')
        if hashlib.sha256((BASE/name).read_bytes()).hexdigest()!=sha: raise RuntimeError('Package hash mismatch: '+name)
        seen.add(name)
    if seen!=FILES: raise RuntimeError('Incomplete package')
    print('PROJECT READ PACKAGE CHECK: PASS; 6 payloads',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('step',choices=['check-package','apply','verify','provision-reader','verify-db-reader'])
    p.add_argument('--r2-dir',default=str(Path.home()/'ts-db-m0-20260921-r2'))
    p.add_argument('--database',default='ee_platform')
    p.add_argument('--port',type=int,default=5432)
    p.add_argument('--system-id',required=False)
    p.add_argument('--backup-receipt')
    p.add_argument('--reader-subject')
    p.add_argument('--confirm-project-code')
    a=p.parse_args()
    check_package()
    if a.step=='check-package': return
    if sys.platform!='linux' or os.geteuid()==0: raise RuntimeError('Run on Ubuntu as normal SSH user, not sudo Python')
    if a.database!='ee_platform' or a.port!=5432 or a.system_id!='7686454253092706426': raise RuntimeError('Not the reviewed company database/cluster')
    r2=Path(a.r2_dir).expanduser().resolve()
    sys.path.insert(0,str(r2))
    spec=importlib.util.spec_from_file_location('r2_server_step',r2/'server_step.py')
    old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
    old.package_check();old.validate_target(a);old.require_db(a);old.require_migration(a)
    if a.step in ('apply','provision-reader'):
        old.require_quiet(a);old.backup_receipt(a)
        if a.confirm_project_code!='XRAY-DVR-SAMPLE': raise RuntimeError('Explicit --confirm-project-code XRAY-DVR-SAMPLE required')
    if a.step=='provision-reader':
        old.psql(old.transaction((BASE/'002_reader_role.sql').read_text(encoding='utf-8')),a.database,a.port)
        print('DB READER ROLE READY: ee_project_api_ro; password NOT set/changed. Set it with psql \\password before TCP use.')
        return
    if a.step=='verify-db-reader':
        old.psql('BEGIN READ ONLY;\n'+(BASE/'verify_db_reader.sql').read_text(encoding='utf-8')+'\nCOMMIT;',a.database,a.port)
        print('DB READER GRANTS VERIFIED: PASS; workspace aggregation tables are SELECT-only.')
        return
    subject=a.reader_subject
    if not subject or subject!=subject.strip() or len(subject)>100 or subject.startswith('manual:ssh:'):
        raise RuntimeError('Explicit authenticated --reader-subject required, e.g. current demo JWT subject; not DBA importer')
    prefix=old.identity_settings()+"SELECT set_config('ee.reader_subject',"+old.literal(subject)+",true);\n"
    verify=(BASE/'verify_data.sql').read_text(encoding='utf-8')
    reader=(BASE/'verify_reader.sql').read_text(encoding='utf-8')
    if a.step=='apply':
        print('Reuse XRAY-DVR-SAMPLE -> 测试项目1; only function -> 行车记录仪DVR; project.read for authenticated subject:',subject,flush=True)
        body=prefix+"SET LOCAL ee.allow_original='on';\n"+verify+(BASE/'001_prepare.sql').read_text(encoding='utf-8')+"SET LOCAL ee.allow_original='off';\n"+verify+reader+'SET CONSTRAINTS ALL IMMEDIATE;'
        old.psql(old.transaction(body),a.database,a.port)
        print('TEST PROJECT SETUP COMMITTED; all original data identities/content preserved; no object accepted. API not yet deployed.')
    else:
        old.psql('BEGIN READ ONLY;\n'+prefix+"SET LOCAL ee.allow_original='off';\n"+verify+reader+'COMMIT;',a.database,a.port)
        print('RENAMED SAMPLE + READER MAPPING: PASS; this is not live API acceptance.')


if __name__=='__main__':
    try: main()
    except (RuntimeError,ValueError,OSError,KeyError) as e:
        print('STOP:',e,file=sys.stderr);sys.exit(1)
