(
  set -euo pipefail
  SCRIPT='/home/t7920/workflows-backup-20261003-r1-incoming/maintenance-backup-workflows-r2.sh'
  test -f "$SCRIPT"
  test ! -L "$SCRIPT"
  printf '%s  %s\n' \
    '7daf0be73a5d4acabab12348dd4ad15a003b271e0a9c676855d9362d24fd2078' \
    "$SCRIPT" | sha256sum -c -
  bash "$SCRIPT"
)
