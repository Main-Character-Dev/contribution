#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check-native-toolchain.py
xcodebuild -project apps/ios-qualification/QualificationFixture.xcodeproj -scheme QualificationFixture \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$PWD/.build/ios-qualification" CODE_SIGNING_ALLOWED=NO build
