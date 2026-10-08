#!/usr/bin/env python3
"""User-executed Ubuntu preparation. No SSH, table DDL, password change or sample writes."""
import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
FILES = frozenset(['001_creator_role.sql', '002_verify_creator.sql', '003_verify_reader.sql', '004_preconditions.sql', 'project_create_step.py'])


def check_package():
    raw = (BASE / 'SHA256SUMS').read_bytes()
    if b'\r' in raw or raw.startswith(b'\xef\xbb\xbf'):
        raise RuntimeError('Manifest must be LF without BOM')
    seen = set()
    for line in raw.decode('utf-8').splitlines():
        sha, name = line.split('  ', 1)
        if name not in FILES or name in seen or (BASE / name).is_symlink():
            raise RuntimeError('Unexpected/duplicate/symlink payload')
        if hashlib.sha256((BASE / name).read_bytes()).hexdigest() != sha:
            raise RuntimeError('Payload hash mismatch: ' + name)
        seen.add(name)
    if seen != FILES:
        raise RuntimeError('Incomplete payloads')
    print('PROJECT CREATE PACKAGE CHECK: PASS; 5 payloads', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', choices=['check-package', 'inspect', 'provision', 'verify'])
    parser.add_argument('--r2-dir', default=str(Path.home() / 'ts-db-m0-20260921-r2'))
    parser.add_argument('--database', default='ee_platform')
    parser.add_argument('--port', type=int, default=5432)
    parser.add_argument('--system-id')
    parser.add_argument('--backup-receipt')
    parser.add_argument('--confirm-create-role')
    args = parser.parse_args()
    check_package()
    if args.step == 'check-package':
        return
    if sys.platform != 'linux' or os.geteuid() == 0:
        raise RuntimeError('Run on Ubuntu as ordinary SSH user; never sudo Python')
    if args.database != 'ee_platform' or args.port != 5432 or args.system_id != '7686454253092706426':
        raise RuntimeError('Not the reviewed company database/cluster')
    r2 = Path(args.r2_dir).expanduser().resolve()
    sys.path.insert(0, str(r2))
    spec = importlib.util.spec_from_file_location('r2_server_step', r2 / 'server_step.py')
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    old.package_check()
    old.validate_target(args)
    old.require_db(args)
    old.require_migration(args)
    preconditions = (BASE / '004_preconditions.sql').read_text(encoding='utf-8')
    reader = (BASE / '003_verify_reader.sql').read_text(encoding='utf-8')
    verify = (BASE / '002_verify_creator.sql').read_text(encoding='utf-8')
    if args.step == 'provision':
        if args.confirm_create_role != 'ee_project_api_create':
            raise RuntimeError('Explicit --confirm-create-role ee_project_api_create required')
        old.require_quiet(args)
        old.backup_receipt(args)
        body = preconditions + reader + (BASE / '001_creator_role.sql').read_text(encoding='utf-8') + verify + reader
        old.psql(old.transaction(body), args.database, args.port)
        print('PROJECT CREATOR READY; validation committed in same transaction; password NOT set/changed. No business rows inserted.')
    else:
        body = preconditions + reader + (verify if args.step == 'verify' else '')
        old.psql("BEGIN READ ONLY; SET LOCAL statement_timeout='15s';\n" + body + '\nCOMMIT;', args.database, args.port)
        print('PROJECT CREATE ' + args.step.upper() + ': PASS; READ ONLY.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, KeyError) as error:
        print('STOP:', error, file=sys.stderr)
        sys.exit(1)
