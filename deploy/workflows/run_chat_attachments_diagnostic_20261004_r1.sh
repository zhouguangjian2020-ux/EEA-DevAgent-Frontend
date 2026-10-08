(
    set -euo pipefail
    SCRIPT='/home/t7920/chat-attachment-diagnostics-20261004-r1-incoming/inspect_chat_attachments_20261004_r1.py'
    CONTAINER='ts-agent-backend-20261003-workflows-r2'
    EXPECTED_IMAGE='sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'

    test "$(id -un)" = 't7920' || { echo 'STOP: run as t7920'; exit 1; }

    printf '%s  %s\n' '31509ee4b5f03e80600e0513f940adb6308223368ac40877f857a3e1a943ac05' "$SCRIPT" | sha256sum -c -

    ACTUAL=$(docker inspect --format '{{.State.Running}} {{.Image}}' "$CONTAINER")
    if [ "$ACTUAL" != "true $EXPECTED_IMAGE" ]; then
        echo 'STOP: main backend state or image differs; no diagnostic executed'
        exit 1
    fi

    echo '=== read-only stored attachment check ==='
    docker exec -i "$CONTAINER" python -B - < "$SCRIPT"
)
