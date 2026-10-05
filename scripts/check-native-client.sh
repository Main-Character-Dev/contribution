#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/dev.sh build
xcrun swift build --package-path apps/macos/Packages/ContributionPlatform --scratch-path .build/native-client --product ContributionProbe
.tools/node/bin/node tests/integration/native-client.mjs "$PWD/.build/native-client/debug/ContributionProbe"
