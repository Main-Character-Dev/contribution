import json
import plistlib
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parent.parent
app = root / ".build/native/Build/Products/Debug/Contribution.app"
v = json.loads((root / "version.json").read_text())
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
assert info["CFBundleShortVersionString"] == v["version"]
assert info["CFBundleVersion"] == v["build"]
assert info["LSMinimumSystemVersion"] == "14.0"
assert info["CFBundleIdentifier"] == "dev.contribution.foundation"
binary = app / "Contents/MacOS/Contribution"
assert subprocess.check_output(["lipo", "-archs", str(binary)], text=True).strip() == "arm64"
load = subprocess.check_output(["otool", "-l", str(binary)], text=True)
assert "minos 14.0" in load
allowed = {"Contents/Info.plist", "Contents/PkgInfo", "Contents/MacOS/Contribution"}
actual = {str(p.relative_to(app)) for p in app.rglob("*") if p.is_file()}
assert actual == allowed, "Unexpected app resources: " + str(actual - allowed)
print("Unsigned development app verified: arm64, macOS 14.0, shared version, three allowlisted bundle files.")
