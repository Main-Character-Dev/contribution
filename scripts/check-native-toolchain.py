import json
import platform
import subprocess
from pathlib import Path
p = json.loads((Path(__file__).resolve().parent.parent / "toolchain.json").read_text())
assert platform.system() == "Darwin" and platform.machine() == p["architecture"], "Native S0 builds require Apple Silicon macOS"
version = subprocess.check_output(["xcodebuild", "-version"], text=True).splitlines()
assert version == ["Xcode " + p["xcode"], "Build version " + p["xcodeBuild"]], "Use the pinned Xcode via DEVELOPER_DIR; do not change global selection"
swift = subprocess.check_output(["xcrun", "swift", "--version"], text=True)
assert "Apple Swift version " + p["swift"] + " " in swift, "Unexpected Swift toolchain"
print("Pinned native toolchain verified.")
