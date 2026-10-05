import json
import plistlib
import subprocess
import hashlib
import re
import os
import zipfile
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
allowed = {"Contents/Info.plist", "Contents/PkgInfo", "Contents/MacOS/Contribution", "Contents/Resources/Sparkle-LICENSE.txt"}
pin = json.loads((root / 'config/sparkle.json').read_text())
archive = root / '.build/swift-cache/artifacts' / re.sub(r'[^A-Za-z0-9_]', '_', pin['url'])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == pin['sha256']
framework = app / 'Contents/Frameworks/Sparkle.framework'
prefix = 'Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework/'
with zipfile.ZipFile(archive) as source:
    expected = {entry.filename[len(prefix):] for entry in source.infolist()
                if entry.filename.startswith(prefix) and not entry.is_dir()
                and not {'Headers', 'PrivateHeaders', 'Modules'}.intersection(Path(entry.filename).parts)}
    actual_framework = {str(p.relative_to(framework)) for p in framework.rglob('*') if p.is_file() or p.is_symlink()}
    assert actual_framework == expected, 'Unexpected or missing Sparkle payload files'
    for relative in expected:
        path = framework / relative
        value = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
        assert value == source.read(prefix + relative), 'Bundled Sparkle differs from checksum-pinned upstream: ' + relative
        assert path.resolve().is_relative_to(framework.resolve()), 'Sparkle symlink escaped the bundle'
        if path.is_file(): allowed.add(str(path.relative_to(app)))
    assert (app / 'Contents/Resources/Sparkle-LICENSE.txt').read_bytes() == source.read('LICENSE')
for setting in ['SUEnableAutomaticChecks', 'SUAutomaticallyUpdate', 'SUAllowsAutomaticUpdates', 'SUSendProfileInfo']:
    assert info[setting] is False
actual = {str(p.relative_to(app)) for p in app.rglob("*") if p.is_file()}
assert actual == allowed, "Unexpected app resources: " + str(actual - allowed)
print("Unsigned development app verified: arm64, macOS 14.0, shared version, exact pinned Sparkle runtime and license; automatic updates disabled.")
