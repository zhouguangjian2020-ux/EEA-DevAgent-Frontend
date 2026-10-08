(
    set -euo pipefail
    echo '=== TS container states ==='
    docker ps -a --filter 'name=ts-agent-' --format 'table {{.Names}}  {{.Image}}  {{.Status}}'

    echo '=== service health ==='
    for URL in 'http://192.168.64.3:7000/health' 'http://127.0.0.1:7018/health' 'http://192.168.64.3:7200/health'; do
        echo "CHECK $URL"
        if curl --noproxy '*' -fsS --connect-timeout 3 --max-time 5 "$URL"; then
            echo
        else
            echo "UNREACHABLE_OR_UNHEALTHY: $URL"
        fi
    done

    echo '=== current main backend UC template ==='
    CONTAINER='ts-agent-backend-20261003-workflows-r2'
    EXPECTED='true sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
    ACTUAL=$(docker inspect --format '{{.State.Running}} {{.Image}}' "$CONTAINER")
    if [ "$ACTUAL" != "$EXPECTED" ]; then
        echo 'STOP: backend state or image differs; no request sent'
        exit 1
    fi

    docker exec -i "$CONTAINER" python -B - <<'PY'
import sys
import httpx
from app.core.config import settings

key = settings.agent_callback_key.get_secret_value().strip()
if not key:
    print('STOP: AGENT_CALLBACK_KEY is not configured')
    sys.exit(1)

url = 'http://192.168.64.3:7000/v1/agent/uc-template?scene=FROM_PRD_CREATE_UC'
try:
    with httpx.Client(timeout=10.0, trust_env=False, follow_redirects=False) as client:
        missing = client.get(url)
        print('WITHOUT_KEY_HTTP_STATUS=', missing.status_code, sep='')
        response = client.get(url, headers={'X-Agent-Internal-Key': key})
        print('WITH_KEY_HTTP_STATUS=', response.status_code, sep='')
    if missing.status_code != 401 or response.status_code != 200:
        print('UC_TEMPLATE_AUTH_CHECK_FAILED: response bodies withheld')
        sys.exit(1)
    body = response.json()
    if (not isinstance(body, dict)
            or body.get('scene') != 'FROM_PRD_CREATE_UC'
            or not isinstance(body.get('fields'), list)
            or len(body['fields']) != 12
            or not isinstance(body.get('candidate_schema'), dict)):
        print('UC_TEMPLATE_CONTRACT_CHECK_FAILED')
        sys.exit(1)
except (httpx.HTTPError, ValueError) as error:
    print('CHECK_FAILED: ' + type(error).__name__ + '; details withheld')
    sys.exit(1)

print('UC_TEMPLATE_AUTH_OK')
print('READ_ONLY_CHECK_FINISHED: no key printed; no service changes')
PY
)
