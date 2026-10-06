#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/swift-module-cache
xcrun swiftc -module-cache-path "$PWD/.build/swift-module-cache" -swift-version 6 -target arm64-apple-macosx14.0 -D CONTRIBUTION_TEST_SUPPORT_ROOT apps/macos/VerifiedPayload.swift apps/macos/ServiceLauncher.swift -o .build/ContributionLauncherProbe
.tools/node/bin/node tests/integration/native-payload.mjs "$PWD/.build/ContributionLauncherProbe"
