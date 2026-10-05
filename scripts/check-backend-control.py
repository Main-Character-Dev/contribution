"""Compile only the Go transport overlay into a disposable interoperability server.

No upstream device library or backend executable is linked or run. The fixture
uses synthetic Unix IPC, a temporary session key and one fixed synthetic device.
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT / 'config/go-ios.json').read_text())
GO = shutil.which('go')
if not GO:
    raise SystemExit('The pinned Go bootstrap executable is unavailable.')
CACHE = ROOT / '.build/go'
for name in ['modules', 'cache', 'tmp']:
    (CACHE / name).mkdir(parents=True, exist_ok=True)
env = dict(os.environ)
env.update(GOPATH=str(CACHE), GOMODCACHE=str(CACHE / 'modules'), GOCACHE=str(CACHE / 'cache'), GOTMPDIR=str(CACHE / 'tmp'),
           GOTOOLCHAIN=PIN['toolchain'], GOWORK='off', CGO_ENABLED='0', GOFLAGS='', GOENV='off', GOOS='darwin', GOARCH='arm64')
version = subprocess.check_output([GO, 'version'], env=env, text=True, timeout=60).strip()
if version != 'go version ' + PIN['toolchain'] + ' ' + PIN['target']:
    raise SystemExit('The fixture requires the pinned Go toolchain and target.')
with tempfile.TemporaryDirectory(prefix='ct-control-fixture-', dir=CACHE / 'tmp') as temp:
    directory = Path(temp)
    source = (ROOT / 'backends/go-ios/transport/contribution_private.go').read_text()
    if source.count('\npackage ios\n') != 1:
        raise SystemExit('Unexpected transport package declaration.')
    (directory / 'private.go').write_text(source.replace('\npackage ios\n', '\npackage main\n', 1))
    shutil.copyfile(ROOT / 'backends/go-ios/fixtures/control-server.go', directory / 'main.go')
    executable = directory / 'control-fixture'
    subprocess.run([GO, 'build', '-trimpath', '-buildvcs=false', '-o', str(executable), str(directory / 'private.go'), str(directory / 'main.go')], env=env, check=True, timeout=90)
    subprocess.run([str(ROOT / '.tools/node/bin/node'), str(ROOT / 'tests/integration/backend-control.mjs'), str(executable)], cwd=ROOT, check=True, timeout=45)
