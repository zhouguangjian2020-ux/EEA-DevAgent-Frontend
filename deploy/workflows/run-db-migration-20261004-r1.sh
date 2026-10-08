#!/usr/bin/env bash
(
  set -euo pipefail
  SCRIPT=/home/t7920/workflows-db-migration-20261004-r1-incoming/migrate_workflows_20261004_r1.py
  printf '%s  %s\n' '0e79f293d10199661203421de8e1d10b167d190261cdc62a5c324fe5634e6f4a' "$SCRIPT" | sha256sum -c -
  sudo -v
  python3 "$SCRIPT" --check-only
  python3 "$SCRIPT"
)
