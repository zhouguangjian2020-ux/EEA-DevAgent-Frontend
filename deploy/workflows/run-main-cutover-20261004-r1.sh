#!/usr/bin/env bash
(
  set -euo pipefail
  SCRIPT=/home/t7920/workflows-main-cutover-20261004-r1-incoming/cutover_main_workflows_20261004_r1.py
  printf '%s  %s\n' 'f9581695b96dd8d5f89f40347eb3d700fce513cc63e0437c9cb54c1d4bd4484e' "$SCRIPT" | sha256sum -c -
  python3 "$SCRIPT" --check-only
  python3 "$SCRIPT"
)
