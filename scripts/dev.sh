#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime="$PWD/.tools/node/bin"
export PATH="$runtime:$PATH"
exec "$runtime/node" "$PWD/.tools/pnpm/package/bin/pnpm.mjs" "$@"
