#!/usr/bin/env bash
# Run by the user on Ubuntu after upload. Frontend-only cutover.
set -euo pipefail
SCRIPT=/home/t7920/workflows-frontend-cutover-20261004-r2-incoming/cutover_frontend_workflows_20261004_r2.py
printf '%s  %s\n' 'f92f35ec38752bb2b7090d001567e54d80bf4cffd6ad72ed2161e94134a7a7d7' "$SCRIPT" | sha256sum -c -
python3 "$SCRIPT" --check-only
python3 "$SCRIPT"
