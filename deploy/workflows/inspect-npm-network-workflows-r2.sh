(
  set -u
  if [ "$(uname -s)" != 'Linux' ]; then
    echo 'STOP: run this on the company Ubuntu server'
    exit 1
  fi

  echo '=== completed backend image ==='
  docker image inspect ts-agent-backend:20261003-workflows-r2 \
    --format 'id={{.Id}}'

  echo '=== failed build container network, if retained ==='
  if docker inspect 293aa520b158 >/dev/null 2>&1; then
    docker inspect 293aa520b158 \
      --format 'status={{.State.Status}} network={{.HostConfig.NetworkMode}}'
  else
    echo 'BUILD_CONTAINER_NOT_AVAILABLE: no container will be recreated'
  fi

  echo '=== host proxy presence; no values printed ==='
  for name in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; do
    if [ -n "${!name:-}" ]; then
      echo "$name=SET"
    else
      echo "$name=UNSET_OR_EMPTY"
    fi
  done

  echo '=== DNS lookup, maximum 12 seconds ==='
  timeout 12s getent ahostsv4 registry.npmjs.org
  echo "DNS_EXIT_CODE=$?"

  URL='https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz'
  FORMAT='HTTP=%{http_code} DNS=%{time_namelookup} CONNECT=%{time_connect} TLS=%{time_appconnect} IP=%{remote_ip}\n'

  echo '=== HTTPS HEAD, default address selection ==='
  curl -q --head --fail --silent --show-error \
    --connect-timeout 10 --max-time 20 --output /dev/null \
    --write-out "$FORMAT" "$URL"
  echo "CURL_DEFAULT_EXIT_CODE=$?"

  echo '=== HTTPS HEAD, IPv4 ==='
  curl -q --ipv4 --head --fail --silent --show-error \
    --connect-timeout 10 --max-time 20 --output /dev/null \
    --write-out "$FORMAT" "$URL"
  echo "CURL_IPV4_EXIT_CODE=$?"

  echo '=== original services after failed build ==='
  for url in \
    'http://192.168.64.3:7000/health' \
    'http://192.168.64.3:7100/api/health' \
    'http://127.0.0.1:7018/health' \
    'http://192.168.64.3:7200/health'; do
    echo "CHECK $url"
    curl -q --fail --silent --show-error --connect-timeout 3 --max-time 8 "$url"
    code=$?
    printf '\nHEALTH_EXIT_CODE=%s\n' "$code"
  done
  echo 'NETWORK_INSPECTION_FINISHED: no build, database migration, or service change performed'
)
