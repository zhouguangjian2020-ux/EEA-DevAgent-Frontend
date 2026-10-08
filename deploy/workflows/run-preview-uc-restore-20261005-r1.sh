(
    set -euo pipefail
    test "$(id -un)" = 't7920' || { echo 'STOP: run as t7920'; exit 1; }
    SCRIPT='/home/t7920/preview-uc-restore-20261005-r1-incoming/restore_preview_uc_20261005_r1.py'
    printf '%s  %s\n' '397c848231d0e8180487cb59823e276864746349380caa10e3e5e8c40ad3d1cd' "$SCRIPT" | sha256sum -c -
    python3 "$SCRIPT" --check-only
    python3 "$SCRIPT"
)
