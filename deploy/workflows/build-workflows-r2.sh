(
  set -euo pipefail
  umask 077
  trap 'echo "BUILD_STEP_FAILED: keep existing containers and completed images; do not rerun the whole block" >&2' ERR

  RELEASE='/data/ts-platform-managed/20261003/workflows-r2'
  TAG='20261003-workflows-r2'
  DIRS=(
    "$RELEASE/ts-backend-$TAG"
    "$RELEASE/ts-frontend-$TAG"
    "$RELEASE/ts-backend-agent-console-$TAG"
    "$RELEASE/ts-agent-console-$TAG"
  )
  IMAGES=(
    "ts-agent-backend:$TAG"
    "ts-agent-frontend:$TAG"
    "ts-agent-backend:agent-console-$TAG"
    "ts-agent-console:$TAG"
  )

  check_health() {
    for url in \
      'http://192.168.64.3:7000/health' \
      'http://192.168.64.3:7100/api/health' \
      'http://127.0.0.1:7018/health' \
      'http://192.168.64.3:7200/health'; do
      echo "CHECK $url"
      curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "$url"
      printf '\n'
    done
  }

  echo '=== build preflight ==='
  test "$(uname -s)" = 'Linux'
  test -d "$RELEASE"
  test ! -L "$RELEASE"
  test "$(docker info --format '{{.OSType}}')" = 'linux'
  docker image inspect python:3.12-slim >/dev/null
  docker image inspect node:22-bookworm-slim >/dev/null

  for image in "${IMAGES[@]}"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      echo "STOP: target image already exists; keep it and report: $image"
      exit 1
    fi
  done
  for dir in "${DIRS[@]}"; do
    test -d "$dir"
    test ! -L "$dir"
    test -f "$dir/Dockerfile"
    test -f "$dir/.dockerignore"
    ( cd "$dir"; sha256sum --quiet -c SHA256SUMS )
  done
  check_health

  echo '=== build four images sequentially; no cutover ==='
  for i in "${!DIRS[@]}"; do
    echo "BUILD ${IMAGES[$i]}"
    args=(--network=host --pull=false)
    if [ "$i" -eq 1 ]; then
      args+=(--build-arg 'BACKEND_URL=http://192.168.64.3:7000')
    fi
    docker build "${args[@]}" --tag "${IMAGES[$i]}" "${DIRS[$i]}"
  done

  echo '=== built image IDs ==='
  for image in "${IMAGES[@]}"; do
    printf '%s ' "$image"
    docker image inspect --format '{{.Id}}' "$image"
  done
  echo '=== original service health ==='
  check_health
  docker ps --filter 'name=ts-agent-' \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  echo 'BUILD_OK: 4 images built; no database migration or container cutover performed'
)
