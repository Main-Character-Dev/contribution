#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
destination="${1:?Pass a new absolute development .app output path}"
[[ "$destination" = /* && "$destination" = *.app && ! -e "$destination" ]] || { echo "Output must be a new absolute .app path" >&2; exit 2; }
bash scripts/dev.sh build
bash scripts/dev.sh native:build
ditto .build/native/Build/Products/Debug/Contribution.app "$destination"
mkdir -p "$destination/Contents/Resources" "$destination/Contents/Library/LaunchAgents"
.tools/node/bin/node scripts/package-payload.mjs "$destination/Contents/Resources/Engine"
xcrun swiftc -swift-version 6 -target arm64-apple-macosx14.0 apps/macos/VerifiedPayload.swift apps/macos/ServiceLauncher.swift -o "$destination/Contents/Library/ContributionService"
xcrun swiftc -swift-version 6 -target arm64-apple-macosx14.0 -D CONTRIBUTION_CLI apps/macos/VerifiedPayload.swift apps/macos/ServiceLauncher.swift -o "$destination/Contents/MacOS/contribution"
cp apps/macos/Config/dev.contribution.service.plist "$destination/Contents/Library/LaunchAgents/dev.contribution.service.plist"
"$destination/Contents/Resources/Engine/runtime/node" "$destination/Contents/Resources/Engine/node_modules/@contribution/cli/dist/main.js" version --json
echo "Packaged unsigned development app. Registration, signing and release qualification are separate."
