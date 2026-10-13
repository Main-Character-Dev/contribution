#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime="$PWD/.tools/node/bin"
export PATH="$runtime:$PATH"
pnpm_version="$("$runtime/node" -p 'require("./toolchain.json").pnpm')"
export PATH="$PWD/.tools/pnpm-$pnpm_version/package:$PATH"
exec "$PWD/.tools/pnpm-$pnpm_version/package/pnpm" "$@"
