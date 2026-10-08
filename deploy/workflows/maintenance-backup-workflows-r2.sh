(
  set -Eeuo pipefail
  umask 077
  STAGE=preflight
  trap 'echo "BACKUP_STAGE_FAILED stage=$STAGE; no automatic restart; retain files and report output" >&2' ERR
  test "$(uname -s)" = Linux
  test "$(id -un)" = t7920

  TOOL='/data/ts-platform-managed/20260929/database-migrations/ts-db-m0-20260921-r2'
  NAMES=(ts-agent-backend-20261002-project-role-r1 ts-agent-backend-console-20261002-r7)
  EXPECTED=(
    'sha256:a6f0dc8ba3a05bfd68ceee0cd6ac23bd1e2811fdef8ac4c6e9aad8c265401517'
    'sha256:fee63cada1554284b3b6992faffd78d6615cc026e2730f3b98f827ae02b910f5'
  )
  IDS=()

  echo '=== verify backup tools before stopping services ==='
  test -d "$TOOL"
  test ! -L "$TOOL"
  (
    cd "$TOOL"
    printf '%s  %s\n' \
      '811ec9bab9089c67e7c37e00468077bdb8c315397839fbd97a1d5e974f3dd8a7' \
      SHA256SUMS | sha256sum -c -
    sha256sum --quiet -c SHA256SUMS
  )
  command -v python3 >/dev/null
  for bin in psql pg_dump pg_restore pg_dumpall; do
    test -x "/usr/lib/postgresql/18/bin/$bin"
  done
  sudo -v
  PSQL=(sudo -n -u postgres env
    'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000'
    /usr/lib/postgresql/18/bin/psql -X -w -h /var/run/postgresql -p 5432
    -U postgres -d ee_platform -v ON_ERROR_STOP=1 -P pager=off)
  facts=$("${PSQL[@]}" -At -F '|' -c \
    "SELECT current_database(),system_identifier::text,current_setting('server_version_num')::integer/10000,pg_is_in_recovery() FROM pg_control_system();")
  test "$facts" = 'ee_platform|7686454253092706426|18|f'

  for i in "${!NAMES[@]}"; do
    info=$(docker inspect --format '{{.Id}} {{.Image}} {{.State.Status}} {{.HostConfig.NetworkMode}}' "${NAMES[$i]}")
    read -r cid image status network <<<"$info"
    test "$image" = "${EXPECTED[$i]}"
    test "$status" = running
    test "$network" = host
    IDS+=("$cid")
  done
  RUN_DIR=$(mktemp -d "$HOME/ts-workflows-backup-20261003.XXXXXX")
  printf 'BACKUP_DIR=%s\n' "$RUN_DIR"
  df -h "$RUN_DIR"

  STAGE=stopping_backends
  echo '=== stop only the two approved backends ==='
  for cid in "${IDS[@]}"; do
    docker stop --timeout 60 "$cid"
    test "$(docker inspect --format '{{.State.Running}}' "$cid")" = false
  done

  STAGE=checking_other_clients
  clients=$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname='ee_platform' AND backend_type='client backend' AND pid<>pg_backend_pid();")
  echo "OTHER_DATABASE_CLIENTS=$clients"
  if [ "$clients" != 0 ]; then
    "${PSQL[@]}" -c "SELECT usename,application_name,state,count(*) AS sessions FROM pg_stat_activity WHERE datname='ee_platform' AND backend_type='client backend' AND pid<>pg_backend_pid() GROUP BY usename,application_name,state ORDER BY usename,application_name,state;"
    echo 'STOP: close known clients or pause their jobs; no session was terminated'
    false
  fi

  STAGE=database_backup
  (
    cd "$TOOL"
    python3 server_step.py backup --database ee_platform --port 5432 \
      --system-id 7686454253092706426 --backup-dir "$RUN_DIR"
  ) 2>&1 | tee "$RUN_DIR/backup.log"

  STAGE=roles_snapshot
  sudo -n -u postgres /usr/lib/postgresql/18/bin/pg_dumpall \
    -h /var/run/postgresql -p 5432 -U postgres --no-password \
    --roles-only --no-role-passwords > "$RUN_DIR/roles-before-no-passwords.sql"
  test -s "$RUN_DIR/roles-before-no-passwords.sql"
  sha256sum "$RUN_DIR/roles-before-no-passwords.sql" | tee "$RUN_DIR/roles-before-no-passwords.sha256"

  STAGE=verify_receipt
  python3 - "$RUN_DIR" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
receipts = list(root.glob('*.backup.json'))
if len(receipts) != 1:
    raise SystemExit('STOP: exactly one backup receipt required')
r = json.loads(receipts[0].read_text(encoding='utf-8'))
if (r.get('database') != 'ee_platform' or r.get('system_identifier') != '7686454253092706426'
        or r.get('archive_list_validated') is not True or r.get('restore_drill_done') is not False):
    raise SystemExit('STOP: backup receipt target or validation flags mismatch')
dump = Path(r['dump']).resolve()
if dump.parent != root or not dump.is_file() or dump.stat().st_size == 0:
    raise SystemExit('STOP: backup file location or size invalid')
h = hashlib.sha256()
with dump.open('rb') as f:
    for block in iter(lambda: f.read(1024 * 1024), b''):
        h.update(block)
if h.hexdigest() != r.get('sha256'):
    raise SystemExit('STOP: backup checksum mismatch')
print('=== verified backup receipt ===')
print(json.dumps({k: r[k] for k in ('created_at','system_identifier','database','dump',
      'sha256','archive_list_validated','restore_drill_done')}, indent=2))
print('BACKUP_RECEIPT=' + str(receipts[0]))
print('BACKUP_FILE_HASH_OK; archive listing checked; no restore drill performed')
PY

  STAGE=final_quiet_check
  for cid in "${IDS[@]}"; do
    test "$(docker inspect --format '{{.State.Running}}' "$cid")" = false
  done
  clients=$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname='ee_platform' AND backend_type='client backend' AND pid<>pg_backend_pid();")
  echo "OTHER_DATABASE_CLIENTS_AFTER_BACKUP=$clients"
  test "$clients" = 0
  printf 'BACKUP_DIR=%s\n' "$RUN_DIR"
  echo 'BACKUP_STAGE_OK: two backends remain stopped; no migration or new-container cutover performed'
)
