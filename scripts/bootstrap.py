"""Scoped macOS development tools. No global installs or shell/profile changes."""
import base64
import hashlib
import inspect
import json
import platform
import subprocess
import tarfile
import urllib.request
from pathlib import Path

if "filter" not in inspect.signature(tarfile.TarFile.extractall).parameters:
    raise SystemExit("Use Python 3.11+ with tarfile data-filter support (for example python3.14).")

ROOT = Path(__file__).resolve().parent.parent
PINS = json.loads((ROOT / "toolchain.json").read_text())
if platform.system() != "Darwin" or platform.machine() != "arm64":
    raise SystemExit("The pinned S0 bootstrap is macOS Apple Silicon only.")
TOOLS = ROOT / ".tools"
TOOLS.mkdir(exist_ok=True)

def extract(url, digest, algorithm, destination):
    archive = TOOLS / (algorithm + "-download.tgz")
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read()
    actual = hashlib.new(algorithm, data).digest()
    expected = bytes.fromhex(digest) if algorithm == "sha256" else base64.b64decode(digest)
    if actual != expected:
        raise SystemExit("Tool checksum mismatch: " + url)
    archive.write_bytes(data)
    destination.mkdir(exist_ok=True)
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise SystemExit("Unsafe tool archive path")
            if member.islnk() or member.issym():
                link = (target.parent / member.linkname).resolve()
                if not link.is_relative_to(destination.resolve()):
                    raise SystemExit("Unsafe tool archive link")
        source.extractall(destination, filter="data")
    archive.unlink()  # Verified, task-created reproducible download only.

node = TOOLS / ("node-v" + PINS["node"] + "-darwin-arm64") / "bin/node"
if not node.exists():
    filename = "node-v" + PINS["node"] + "-darwin-arm64.tar.gz"
    url = "https://nodejs.org/dist/v" + PINS["node"] + "/"
    with urllib.request.urlopen(url + "SHASUMS256.txt", timeout=60) as response:
        sums = response.read().decode().splitlines()
    if PINS["nodeDarwinArm64Sha256"] + "  " + filename not in sums:
        raise SystemExit("Pinned checksum disagrees with official Node SHASUMS256.txt")
    extract(url + filename, PINS["nodeDarwinArm64Sha256"], "sha256", TOOLS)
if subprocess.check_output([str(node), "--version"], text=True).strip() != "v" + PINS["node"]:
    raise SystemExit("Wrong scoped Node version")
# pnpm 12 ships a native executable. Pin and verify the platform tarball itself;
# do not let the npm wrapper download a second, unpinned executable.
pnpm_dir = TOOLS / ("pnpm-" + PINS["pnpm"])
pnpm = pnpm_dir / "package/pnpm"
if not pnpm.exists():
    extract("https://registry.npmjs.org/@pnpm/exe.darwin-arm64/-/exe.darwin-arm64-" + PINS["pnpm"] + ".tgz",
            PINS["pnpmIntegrity"].removeprefix("sha512-"), "sha512", pnpm_dir)
if subprocess.check_output([str(pnpm), "--version"], text=True).strip() != PINS["pnpm"]:
    raise SystemExit("Wrong scoped pnpm version")
print("Scoped tools verified: Node " + PINS["node"] + ", pnpm " + PINS["pnpm"])

link = TOOLS / "node"
if link.is_symlink() and link.resolve() != node.parent.parent:
    link.unlink()  # Only the owned bootstrap selector.
if not link.exists():
    link.symlink_to(node.parent.parent.name, target_is_directory=True)
