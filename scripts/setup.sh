#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/bootstrap.py
bash scripts/dev.sh install --frozen-lockfile
