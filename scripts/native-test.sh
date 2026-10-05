#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/dev.sh build
python3 scripts/check-native-toolchain.py
node_path="$PWD/.tools/node/bin/node"
"$node_path" scripts/prepare-swift-parity.mjs
CONTRIBUTION_ROOT="$PWD" xcrun swift test \
  --package-path apps/macos/Packages/ContributionPlatform \
  --scratch-path "$PWD/.build/swift" --disable-sandbox \
  -Xswiftc -module-cache-path -Xswiftc "$PWD/.build/swift-module-cache"
