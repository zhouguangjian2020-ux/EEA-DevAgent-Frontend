#!/usr/bin/env python3
"""Manually invoked Ubuntu PostgreSQL-18 M0 steps. Standard library only.
No SSH, package installation, service/config/HBA changes, drop/truncate or auto-restore.
Run as your normal SSH user (not root). Only the child PostgreSQL CLI uses sudo.
"""
import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from compile_seed import literal

BASE=Path(__file__).resolve().parent
BIN=Path('/usr/lib/postgresql/18/bin')
SOCKET='/var/run/postgresql'
OWNER='ee_m0_owner'
VERSION='001_m0_metadata_r2_20260921'
REQUIRED_FILES=frozenset(['001_m0_schema.sql', '002_seed.sql', '003_verify.sql', '004_smoke_rollback.sql', '005_rules_rollback.sql', 'build_schema.py', 'compile_seed.py', 'compile_checks.py', 'metadata_contract.py', 'server_step.py', 'metadata.sql.inc', 'integrity.sql.inc', 'schema-manifest.json', 'data/prd-numbered.preview.md', 'data/preparation-report.json', 'data/seed-data.json', 'data/type-definitions.json', 'data/instance-contract.json'])

def fail(message):raise RuntimeError(message)
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc)

def psql(sql,db='postgres',port=5432,capture=False):
 cmd=['sudo','-u','postgres',str(BIN/'psql'),'-X','-w','-h',SOCKET,'-p',str(port),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-P','pager=off']
 if capture:cmd+=['-A','-t','-q']
 run=subprocess.run(cmd,input='SET standard_conforming_strings=on;\n'+sql,text=True,encoding='utf-8',stdout=subprocess.PIPE if capture else None,stderr=subprocess.PIPE if capture else None)
 if run.returncode:
  if capture:print(run.stderr,file=sys.stderr)
  fail('psql failed; STOP. No subsequent step was run.')
 return run.stdout.strip() if capture else ''

def jsquery(sql,db,port):
 result=psql(sql,db,port,True)
 return json.loads(result) if result else None

def inspect(port):
 return jsquery("""SELECT json_build_object('database',current_database(),'server_version',current_setting('server_version'),'server_version_num',current_setting('server_version_num')::integer,'system_identifier',system_identifier::text,'data_directory',current_setting('data_directory'),'port',current_setting('port'),'listen_addresses',current_setting('listen_addresses'),'server_encoding',current_setting('server_encoding'),'in_recovery',pg_is_in_recovery()) FROM pg_control_system();""",'postgres',port)

def validate_target(args):
 info=inspect(args.port)
 if not args.system_id or info['system_identifier']!=args.system_id:fail('Cluster system_identifier mismatch/missing. Read inventory; do not guess it.')
 if info['server_version_num']//10000!=18:fail('Expected PostgreSQL major 18; do not upgrade/install automatically.')
 if info['data_directory']!='/data/postgresql/18/main':fail('Unexpected data_directory. Review existing installation first.')
 if info['listen_addresses']!='127.0.0.1' or info['in_recovery']:fail('Unexpected listener/recovery state. No configuration changed.')
 if not args.database or not re.fullmatch(r'[a-z][a-z0-9_]{2,47}',args.database) or args.database in ['postgres','template0','template1']:fail('Use an explicitly confirmed non-system business database name (3..48 lowercase letters/digits/underscore).')
 return info

def db_info(args):
 return jsquery("SELECT row_to_json(x) FROM (SELECT datname,pg_get_userbyid(datdba) owner,pg_encoding_to_char(encoding) encoding,datistemplate,datallowconn FROM pg_database WHERE datname="+literal(args.database)+") x;",'postgres',args.port)

def require_db(args):
 d=db_info(args)
 if d is None:fail('Business database absent. Run bootstrap --create-if-missing only after confirming its name.')
 if d['owner']!=OWNER:fail('Unexpected business database owner; stop without changing it')
 if d['encoding']!='UTF8' or d['datistemplate'] or not d['datallowconn']:fail('Target database not writable UTF8 business DB.')
 return d

def require_quiet(args):
 n=int(psql("SELECT count(*) FROM pg_stat_activity WHERE datname="+literal(args.database)+" AND backend_type='client backend' AND pid<>pg_backend_pid();",args.database,args.port,True))
 if n:fail(f'Target has {n} other client session(s). Arrange a change window and close clients; script will not terminate them.')

def package_check():
 sums=BASE/'SHA256SUMS'
 if not sums.exists():fail('Missing SHA256SUMS; use the complete reviewed release package.')
 raw=sums.read_bytes()
 if b'\r' in raw or raw.startswith(b'\xef\xbb\xbf'):fail('SHA256SUMS must be BOM-free LF; re-upload the reviewed R2 archive, do not rewrite SQL')
 seen=set()
 for line in raw.decode('utf-8').splitlines():
  if not line.strip():fail('Blank line in checksum manifest')
  if '  ' not in line:fail('Invalid checksum manifest line')
  expected,name=line.split('  ',1);path=(BASE/name).resolve()
  if name not in REQUIRED_FILES or name in seen or not path.is_relative_to(BASE) or not re.fullmatch('[a-f0-9]{64}',expected):fail('Invalid/duplicate/unexpected checksum entry')
  if not path.is_file() or digest(path)!=expected:fail('Package checksum mismatch: '+name)
  seen.add(name)
 if seen!=REQUIRED_FILES:fail('Checksum manifest omits required release file(s)')
 print('PACKAGE CHECK: PASS; 18 payloads; release '+VERSION)

def backup_receipt(args):
 if not args.backup_receipt:fail('--backup-receipt is required for migrate/seed')
 path=Path(args.backup_receipt).resolve();r=json.loads(path.read_text(encoding='utf-8'))
 dump=Path(r['dump']).resolve()
 if r['database']!=args.database or r['system_identifier']!=args.system_id:fail('Backup belongs to a different database/cluster')
 age=(utc()-dt.datetime.fromisoformat(r['created_at'])).total_seconds()
 if not 0<=age<=86400:fail('Backup older than 24h (or clock mismatch); take a fresh backup.')
 if not dump.is_file() or digest(dump)!=r['sha256']:fail('Backup missing or hash mismatch')
 print('BACKUP RECEIPT: PASS',str(path))

def require_migration(args):
 exists=psql("SELECT to_regclass('ee_admin.schema_migrations') IS NOT NULL;",args.database,args.port,True)=='t'
 if not exists:fail('M0 migration not recorded; run migrate first')
 unexpected=int(psql('SELECT count(*) FROM ee_admin.schema_migrations WHERE version<>'+literal(VERSION)+';',args.database,args.port,True))
 if unexpected:fail('Unknown migration history exists; review before applying this standalone bundle')
 actual=psql('SELECT sha256 FROM ee_admin.schema_migrations WHERE version='+literal(VERSION)+';',args.database,args.port,True)
 if actual!=digest(BASE/'001_m0_schema.sql'):fail('M0 migration checksum absent/different; stop, do not edit/reapply an installed migration')
 check_shape(args)

def check_shape(args):
 manifest=json.loads((BASE/'schema-manifest.json').read_text(encoding='utf-8'))
 expected={t['name']:[f['name'] for f in t['fields'] if f['name']!='ai_run_id'] for t in manifest['tables'] if t['phase']=='M0 CRUD'}
 actual=jsquery("SELECT coalesce(json_object_agg(table_name,columns),'{}'::json) FROM (SELECT table_name,json_agg(column_name ORDER BY ordinal_position) columns FROM information_schema.columns WHERE table_schema='ee' GROUP BY table_name) x;",args.database,args.port)
 if actual!=expected:fail('Database table/column shape differs from reviewed 29-table M0 manifest')
 print('M0 TABLE/COLUMN CHECK: 29 tables, PASS')


def inventory(args):
 print(json.dumps(inspect(args.port),ensure_ascii=False,indent=2),flush=True)
 psql("""SELECT datname,pg_get_userbyid(datdba) AS owner,pg_encoding_to_char(encoding) AS encoding,datistemplate FROM pg_database ORDER BY datname;
SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;
SELECT name,setting FROM pg_settings WHERE name IN ('data_directory','config_file','hba_file','listen_addresses','port','ssl','password_encryption','TimeZone') ORDER BY name;
SELECT datname,usename,application_name,state FROM pg_stat_activity WHERE backend_type='client backend' ORDER BY datname,usename;
""",'postgres',args.port)
 if args.database:
  validate_target(args);require_db(args)
  psql("SELECT nspname,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'; SELECT schemaname,tablename,tableowner FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;",args.database,args.port)
 print('READ ONLY. No database/table was created.')

def bootstrap(args):
 require_quiet(args) if db_info(args) else None
 role=jsquery("SELECT row_to_json(x) FROM (SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='ee_m0_owner') x;",'postgres',args.port)
 if role and any(role.values()):fail('ee_m0_owner exists with unexpected privileges; no role was changed')
 memberships=int(psql("SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='ee_m0_owner';",'postgres',args.port,True))
 if memberships:fail('ee_m0_owner has existing role memberships; manual review required')
 existing=db_info(args)
 if existing is None and not args.create_if_missing:fail('Target DB absent; explicit --create-if-missing required. Nothing created.')
 if existing:require_db(args)
 if not role:psql('CREATE ROLE ee_m0_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;','postgres',args.port)
 if existing is None:
  # CREATE DATABASE intentionally runs outside BEGIN/COMMIT.
  psql(f'CREATE DATABASE "{args.database}" OWNER ee_m0_owner ENCODING \'UTF8\' TEMPLATE template0;','postgres',args.port)
  psql(f'REVOKE ALL ON DATABASE "{args.database}" FROM PUBLIC;','postgres',args.port)
  print('CREATED business database:',args.database)
 else:print('REUSED existing DB; owner, encoding, contents and database privileges were NOT altered:',existing)
 print('NOLOGIN owner only; no application password or network listener was configured.')

def backup(args):
 require_db(args);require_quiet(args)
 directory=Path(args.backup_dir).expanduser().resolve();directory.mkdir(parents=True,exist_ok=True,mode=0o700)
 os.chmod(directory,0o700)
 stamp=utc().strftime('%Y%m%dT%H%M%S%fZ');path=directory/(args.database+'-'+stamp+'.dump')
 cmd=['sudo','-u','postgres',str(BIN/'pg_dump'),'-h',SOCKET,'-p',str(args.port),'-U','postgres','--no-password','--format=custom','--dbname',args.database]
 with path.open('xb') as f:
  os.chmod(path,0o600)
  result=subprocess.run(cmd,stdout=f)
 if result.returncode:fail('Backup failed; partial file retained for diagnosis, no receipt created')
 with path.open('rb') as f:
  result=subprocess.run([str(BIN/'pg_restore'),'--list'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if result.returncode:fail('Archive listing failed; no successful backup receipt created')
 receipt={'created_at':utc().isoformat(),'system_identifier':args.system_id,'database':args.database,'dump':str(path),'sha256':digest(path),'archive_list_validated':True,'restore_drill_done':False}
 rp=path.with_suffix('.backup.json');rp.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8');os.chmod(rp,0o600)
 print('BACKUP:',path);print('BACKUP_RECEIPT:',rp)
 print('Archive listing/hash checked; this is NOT a completed restore drill.')

def transaction(body):
 return "BEGIN;\nSET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'; SET LOCAL client_encoding='UTF8'; SET LOCAL timezone='UTC';\nSELECT pg_advisory_xact_lock(160921,200);\n"+body+"\nCOMMIT;\n"

def migrate(args):
 require_db(args);require_quiet(args);backup_receipt(args)
 recorded=psql("SELECT to_regclass('ee_admin.schema_migrations') IS NOT NULL;",args.database,args.port,True)=='t'
 if recorded:
  require_migration(args);print('MIGRATION ALREADY APPLIED; matching checksum/shape, no DDL repeated.');return
 existing=psql("SELECT nspname FROM pg_namespace WHERE nspname IN ('ee','ee_admin');",args.database,args.port,True)
 if existing:fail('Existing ee/ee_admin schema without matching migration receipt. STOP; no DROP or overwrite allowed.')
 objects=int(psql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S','v','m','f');",args.database,args.port,True))
 if objects:fail('Standalone R2 requires the previously confirmed empty business database; unexpected existing objects, STOP')
 role=psql("SELECT count(*) FROM pg_roles WHERE rolname='ee_m0_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls;",'postgres',args.port,True)
 if role!='1':fail('Missing/suspicious NOLOGIN owner; run bootstrap and inspect roles first')
 ddl=(BASE/'001_m0_schema.sql').read_text(encoding='utf-8')
 admin="""CREATE SCHEMA ee_admin AUTHORIZATION ee_m0_owner;
SET LOCAL ROLE ee_m0_owner;
REVOKE ALL ON SCHEMA ee_admin FROM PUBLIC;
CREATE TABLE ee_admin.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL CHECK (length(sha256)=64),applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL);
REVOKE ALL ON ee_admin.schema_migrations FROM PUBLIC;
RESET ROLE;
"""
 record="INSERT INTO ee_admin.schema_migrations(version,sha256,applied_by) VALUES ("+','.join(literal(x) for x in [VERSION,digest(BASE/'001_m0_schema.sql'),'manual:ssh:'+getpass.getuser()])+');'
 psql(transaction(admin+ddl+record),args.database,args.port)
 require_migration(args)
 print('MIGRATION COMMITTED: 29 business tables + 1 administrative migration-record table. No AI tables.')

def identity_settings():
 subject='manual:ssh:'+getpass.getuser()
 return "SELECT set_config('ee.import_subject',"+literal(subject)+",true); SELECT set_config('ee.import_display_name',"+literal(getpass.getuser())+",true);\n"

def seed(args):
 require_db(args);require_quiet(args);require_migration(args);backup_receipt(args)
 package=json.loads((BASE/'data/seed-data.json').read_text(encoding='utf-8'))
 if args.confirm_project_code!=package['project_code']:fail('--confirm-project-code must exactly match '+package['project_code']+'; no project created')
 print('Target sample project:',package['project_code'],package['project_name'],flush=True)
 psql(transaction(identity_settings()+(BASE/'002_seed.sql').read_text(encoding='utf-8')),args.database,args.port)
 print('SEED COMMITTED (or identical existing rows verified); all business objects remain unaccepted.')
 verify(args)

def verify(args):
 require_db(args);require_migration(args)
 psql('BEGIN READ ONLY;\n'+identity_settings()+(BASE/'003_verify.sql').read_text(encoding='utf-8')+'\nCOMMIT;',args.database,args.port)
 print('DATABASE CONTENT VERIFICATION: PASS. This is not frontend/backend integration.')

def smoke(args):
 require_db(args);require_quiet(args);require_migration(args)
 # The smoke file contains its own BEGIN/ROLLBACK; everything is rolled back.
 psql((BASE/'004_smoke_rollback.sql').read_text(encoding='utf-8'),args.database,args.port)
 psql((BASE/'005_rules_rollback.sql').read_text(encoding='utf-8'),args.database,args.port)
 verify(args)
 print('CONSTRAINT SMOKE CHECKS: PASS; test changes rolled back.')

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('step',choices=['check-package','inventory','bootstrap','backup','migrate','seed','verify','smoke'])
 parser.add_argument('--database');parser.add_argument('--system-id');parser.add_argument('--port',type=int,default=5432)
 parser.add_argument('--create-if-missing',action='store_true')
 parser.add_argument('--backup-dir',default=str(Path.home()/'ts-db-backups'))
 parser.add_argument('--backup-receipt');parser.add_argument('--confirm-project-code')
 args=parser.parse_args()
 try:
  package_check()
  if args.step=='check-package':sys.exit(0)
  if sys.platform!='linux' or os.geteuid()==0:fail('Run on Ubuntu as the normal SSH user; do not sudo the Python script or run it on Windows.')
  if args.port!=5432:fail('Historical target port is 5432; inspect and revise the plan explicitly for another instance')
  if not (BIN/'psql').is_file():fail('Existing PostgreSQL18 client not found; do not reinstall automatically')
  if args.step!='inventory':validate_target(args)
  globals()[args.step](args)
 except (RuntimeError,ValueError,OSError,KeyError) as e:
  print('STOP:',e,file=sys.stderr);sys.exit(1)
