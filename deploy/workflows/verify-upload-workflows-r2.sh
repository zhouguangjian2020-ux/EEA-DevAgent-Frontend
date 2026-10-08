(
  set -euo pipefail
  cd /home/t7920/workflows-20261003-r2-incoming
  echo '=== verify checksum manifest ==='
  printf '%s  %s\n' '8207b93b3752c4861d3738425e6125a5c7a9b4984f562349c4023da7e616d59e' 'SHA256SUMS' | sha256sum -c -
  echo '=== verify release files ==='
  sha256sum -c SHA256SUMS
  echo 'UPLOAD_VERIFIED: no build, database migration, or service change performed'
)
