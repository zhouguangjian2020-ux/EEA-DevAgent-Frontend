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
    SCRIPT='/home/t7920/uc-copy-preflight-20261005-r3-incoming/inspect_uc_copy_20261005_r3.py'
    echo '=== verify r3 readonly inspection script ==='
    echo '57bde1e9a44112478b6e293411425069329c892b98a3b8fb95d7bb021461b007  /home/t7920/uc-copy-preflight-20261005-r3-incoming/inspect_uc_copy_20261005_r3.py' | sha256sum -c -
    echo '=== inspect safe actual backend metadata ==='
    META=$(docker inspect --type container --format '{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{.HostConfig.NetworkMode}}' ts-agent-backend-20261003-workflows-r2)
    IFS='|' read -r -a FIELDS <<< "$META"
    if [ "${#FIELDS[@]}" -ne 4 ]; then echo 'STOP: invalid metadata shape'; exit 1; fi
    echo "image_ref=${FIELDS[0]}"
    echo "actual_image_id=${FIELDS[1]}"
    echo "running=${FIELDS[2]}"
    echo "network=${FIELDS[3]}"
    validate_backend_metadata "${FIELDS[@]}"
    echo '=== inspect source UC and target PRD read-only ==='
    docker exec -i --workdir /app ts-agent-backend-20261003-workflows-r2 python - < "$SCRIPT"
)
