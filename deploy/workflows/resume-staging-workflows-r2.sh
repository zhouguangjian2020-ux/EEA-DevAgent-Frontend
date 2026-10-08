(
  set -euo pipefail
  umask 077
  INCOMING='/home/t7920/workflows-20261003-r2-incoming'
  RELEASE='/data/ts-platform-managed/20261003/workflows-r2'

  test -d "$RELEASE"
  test ! -L "$RELEASE"
  cd "$INCOMING"

  echo '=== verify release metadata ==='
  printf '%s  %s\n' \
    '13d8d0ce18ac2408cc25cb038b0252e7b1104ac3f6394022463343fe115dead1' 'manifest.json' \
    '1cf46192ecca1a2d6b2c6c12b1758e367c4d395e5e7f8d04b63fe0120a7e0cc1' 'RELEASE.md' \
    | sha256sum -c -

  echo '=== copy missing metadata only ==='
  for name in manifest.json RELEASE.md; do
    if [ -e "$RELEASE/$name" ] || [ -L "$RELEASE/$name" ]; then
      if [ -L "$RELEASE/$name" ] || ! cmp -s "$name" "$RELEASE/$name"; then
        echo "STOP: existing metadata differs or is a link: $name"
        exit 1
      fi
    else
      cp -- "$name" "$RELEASE/$name"
    fi
  done

  echo '=== finish staging checks ==='
  python3 - "$RELEASE" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
m = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert m['release_tag'] == '20261003-workflows-r2'
for key in ('company_deployment_executed', 'database_migration_executed',
            'company_docker_build_executed', 'agent_source_modified'):
    assert m[key] is False, key
assert len(m['archives']) == 5
assert m['approved_target']['project_id'] == 'bf8f4d08-d086-44bf-9cbe-f31abc67ee03'
assert m['approved_target']['function_id'] == '3bb1333a-1ebf-428c-831f-c26dcd66cfa3'
for item in m['archives']:
    assert (root / item['root']).is_dir(), item['root']
if any(p.is_file() and (p.name == '.env' or
       p.name.startswith('.env.') and p.name != '.env.example')
       for p in root.rglob('*')):
    raise SystemExit('STOP: private env file found; values not printed')
print('MANIFEST_FACTS_OK')
print('ARCHIVE_COUNT=5')
print('PRIVATE_ENV_CHECK_OK')
PY

  echo 'STAGING_OK: no Docker build, database migration, or service change performed'
)
