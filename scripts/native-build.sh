#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/dev.sh check:generated
python3 scripts/check-native-toolchain.py
xcodebuild -project apps/macos/Contribution.xcodeproj -scheme Contribution \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$PWD/.build/native" \
  CODE_SIGNING_ALLOWED=NO build
python3 scripts/verify-native-artifact.py
