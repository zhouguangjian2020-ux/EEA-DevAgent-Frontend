#!/usr/bin/env bash
(
    set -euo pipefail
    test "$(id -un)" = t7920 || { echo 'STOP: run as t7920'; exit 1; }
    SCRIPT='/home/t7920/uc-copy-preflight-20261005-r1-incoming/inspect_uc_copy_20261005_r1.py'
    echo '=== verify readonly inspection script ==='
    echo 'b4a850c1794750d99e63c6150dd2f52c1d4013fb6ed6854559884caee2d9b06d  /home/t7920/uc-copy-preflight-20261005-r1-incoming/inspect_uc_copy_20261005_r1.py' | sha256sum -c -
    echo '=== verify current main backend identity ==='
    META=$(docker inspect --type container --format '{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{.HostConfig.NetworkMode}}' ts-agent-backend-20261003-workflows-r2)
    test "$META" = 'ts-agent-backend:20261003-workflows-r2|sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989|true|host' || { echo 'STOP: backend identity or running state differs'; exit 1; }
    echo '=== inspect source UC and target PRD read-only ==='
    docker exec -i --workdir /app ts-agent-backend-20261003-workflows-r2 python - < "$SCRIPT"
)
