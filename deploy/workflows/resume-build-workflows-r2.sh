(
  set -Eeuo pipefail
  umask 077
  trap 'echo "RESUME_BUILD_FAILED: keep existing containers and completed images; do not rerun the whole block" >&2' ERR

  RELEASE='/data/ts-platform-managed/20261003/workflows-r2'
  TAG='20261003-workflows-r2'
  BACKEND="ts-agent-backend:$TAG"
  EXPECTED_BACKEND_ID='sha256:4ca6143e223802bc957256f55e78c3f648f3d010208fba2f2171f77df4abb989'
  DIRS=(
    "$RELEASE/ts-frontend-$TAG"
    "$RELEASE/ts-backend-agent-console-$TAG"
    "$RELEASE/ts-agent-console-$TAG"
  )
  IMAGES=(
    "ts-agent-frontend:$TAG"
    "ts-agent-backend:agent-console-$TAG"
    "ts-agent-console:$TAG"
  )

  check_preserved_backend() {
    local actual
    actual=$(docker image inspect --format '{{.Id}}' "$BACKEND")
    if [ "$actual" != "$EXPECTED_BACKEND_ID" ]; then
      echo 'STOP: preserved backend image ID differs; do not rebuild it'
      exit 1
    fi
    echo 'PRESERVED_BACKEND_ID_OK'
  }

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

  echo '=== resume build preflight ==='
  test "$(uname -s)" = 'Linux'
  test -d "$RELEASE"
  test ! -L "$RELEASE"
  test "$(docker info --format '{{.OSType}}')" = 'linux'
  check_preserved_backend
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

  echo '=== build three remaining images; no backend rebuild or cutover ==='
  for i in "${!DIRS[@]}"; do
    echo "BUILD ${IMAGES[$i]}"
    args=(--network=host --pull=false)
    if [ "$i" -eq 0 ]; then
      args+=(--build-arg 'BACKEND_URL=http://192.168.64.3:7000')
    fi
    docker build "${args[@]}" --tag "${IMAGES[$i]}" "${DIRS[$i]}"
  done

  check_preserved_backend
  echo '=== built image IDs ==='
  for image in "$BACKEND" "${IMAGES[@]}"; do
    printf '%s ' "$image"
    docker image inspect --format '{{.Id}}' "$image"
  done
  echo '=== original service health ==='
  check_health
  docker ps --filter 'name=ts-agent-' \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
  echo 'BUILD_OK: all 4 images available; backend preserved; no database migration or container cutover performed'
)
