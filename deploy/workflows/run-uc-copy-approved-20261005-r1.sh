#!/usr/bin/env bash
validate_backend_metadata() {
    if [ "$#" -ne 4 ]; then echo 'STOP: invalid metadata field count'; return 1; fi
    local ref="$1" image_id="$2" running="$3" network="$4"
    local expected='sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
    case "$ref" in
        ts-agent-backend:20261003-workflows-r2|"$expected") ;;
        *) echo 'STOP: unexpected image reference'; return 1 ;;
    esac
    if [ "$image_id" != "$expected" ]; then echo 'STOP: actual image ID differs'; return 1; fi
    if [ "$running" != true ]; then echo 'STOP: main backend is not running'; return 1; fi
    if [ "$network" != host ]; then echo 'STOP: unexpected network mode'; return 1; fi
    echo 'BACKEND_IDENTITY_OK: actual image ID, running state and host network verified'
}
# END_METADATA_VALIDATOR
(
    set -euo pipefail
    test "$(id -un)" = t7920 || { echo 'STOP: run as t7920'; exit 1; }
    test "$#" -eq 1 || { echo 'STOP: choose --check-only or --apply'; exit 1; }
    MODE="$1"
    case "$MODE" in --check-only|--apply) ;; *) echo 'STOP: invalid mode'; exit 1 ;; esac
    BASE='/home/t7920/uc-copy-approved-20261005-r1-incoming'
    SCRIPT="$BASE/copy_approved_ucs_20261005_r1.py"
    echo '=== verify approved copy tool ==='
    printf '%s  %s\n' 'bd87772d4d5120b46e39815331e20fb273583c14e418c9f4497fe78c9d302fe3' "$SCRIPT" | sha256sum -c -
    META=$(docker inspect --type container --format '{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{.HostConfig.NetworkMode}}' ts-agent-backend-20261003-workflows-r2)
    IFS='|' read -r -a FIELDS <<< "$META"
    test "${#FIELDS[@]}" -eq 4 || { echo 'STOP: invalid metadata shape'; exit 1; }
    validate_backend_metadata "${FIELDS[@]}"
    umask 077
    LOG=$(mktemp "$BASE/copy-${MODE#--}-XXXXXX.log")
    echo "COPY_LOG=$LOG"
    echo "=== mode=$MODE; source unchanged; no auto-confirmation ==="
    set +e
    docker exec -i --workdir /app ts-agent-backend-20261003-workflows-r2 python - "$MODE" < "$SCRIPT" 2>&1 | tee "$LOG"
    STATUS=("${PIPESTATUS[@]}")
    set -e
    if [ "${STATUS[0]}" -ne 0 ] || [ "${STATUS[1]}" -ne 0 ]; then
        echo 'COPY_STOPPED: retain private log and stable IDs; do not delete or recreate copies'
        exit 1
    fi
    echo "COPY_EXECUTION_FINISHED mode=$MODE log=$LOG"
)
