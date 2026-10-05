"""Build the pinned research backend and collect linked-module notices; never run it."""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT / 'config/go-ios.json').read_text())
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This prototype pin targets macOS arm64.')
if len(sys.argv) != 2 or not Path(sys.argv[1]).is_absolute():
    raise SystemExit('Pass one new absolute output directory.')
OUTPUT = Path(sys.argv[1])
if OUTPUT.exists():
    raise SystemExit('Output already exists; preserve the earlier build receipt.')
GO = shutil.which('go')
if not GO:
    raise SystemExit('A Go bootstrap executable is required; no global tools are installed by this script.')
CACHE = ROOT / '.build/go'
for name in ['modules', 'cache', 'tmp']:
    (CACHE / name).mkdir(parents=True, exist_ok=True)
env = dict(os.environ)
env.update(GOPATH=str(CACHE), GOMODCACHE=str(CACHE / 'modules'), GOCACHE=str(CACHE / 'cache'), GOTMPDIR=str(CACHE / 'tmp'),
           GOTOOLCHAIN=PIN['toolchain'], GOWORK='off', CGO_ENABLED='0', GOFLAGS='-mod=readonly', GOENV='off',
           GOOS='darwin', GOARCH='arm64', GOPROXY='https://proxy.golang.org', GOSUMDB='sum.golang.org', GOPRIVATE='', GONOPROXY='', GONOSUMDB='')

def go(*args, cwd=ROOT):
    return subprocess.check_output([GO, *args], cwd=cwd, env=env, text=True)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def records(text):
    decoder = json.JSONDecoder()
    while text.strip():
        value, end = decoder.raw_decode(text.lstrip())
        yield value
        text = text.lstrip()[end:]

observed_toolchain = go('version').strip()
if observed_toolchain != 'go version ' + PIN['toolchain'] + ' ' + PIN['target']:
    raise SystemExit('The scoped Go toolchain does not match the pin.')
module = json.loads(go('mod', 'download', '-json', PIN['module'] + '@' + PIN['version']))
if module.get('Sum') != PIN['sum'] or module.get('GoModSum') != PIN['goModSum'] or module.get('Origin', {}).get('Hash') != PIN['revision']:
    raise SystemExit('Pinned source identity or Go checksum mismatch.')
source = Path(module['Dir'])
go('mod', 'verify', cwd=source)
modules = {PIN['module']: module}
for package in records(go('list', '-deps', '-json', '.', cwd=source)):
    dependency = package.get('Module')
    if dependency and not dependency.get('Main'):
        if dependency.get('Replace'):
            raise SystemExit('Unexpected module replacement in dependency graph.')
        modules[dependency['Path']] = dependency
OUTPUT.mkdir(parents=True)
notices = OUTPUT / 'notices'
notices.mkdir()
module_receipts = []
for name, dependency in sorted(modules.items()):
    folder = Path(dependency['Dir'])
    candidates = sorted(file for file in folder.iterdir() if file.is_file() and file.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'AUTHORS', 'PATENTS', 'COPYRIGHT')))
    if not any(file.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING')) for file in candidates):
        raise SystemExit('Missing license for linked module: ' + name)
    target = notices / name.replace('/', '__')
    target.mkdir()
    for file in candidates:
        if file.is_symlink() or file.stat().st_size > 1024 * 1024:
            raise SystemExit('Unexpected license source: ' + name)
        shutil.copyfile(file, target / file.name)
    module_receipts.append({'module': name, 'version': dependency['Version'], 'sum': dependency.get('Sum'), 'notices': [str((target / file.name).relative_to(OUTPUT)) for file in candidates]})
golang = Path(go('env', 'GOROOT').strip()) / 'LICENSE'
shutil.copyfile(golang, notices / 'Go-LICENSE')
go('build', '-trimpath', '-buildvcs=false', '-o', str(OUTPUT / 'ios'), '.', cwd=source)
(OUTPUT / 'build-info.txt').write_text(go('version', '-m', str(OUTPUT / 'ios')))
files = {str(file.relative_to(OUTPUT)): sha(file) for file in sorted(OUTPUT.rglob('*')) if file.is_file()}
(OUTPUT / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'pin': PIN, 'toolchain': observed_toolchain, 'CGO_ENABLED': '0', 'GOWORK': 'off',
    'modules': module_receipts, 'files': files, 'productEnabled': False, 'runtimeExecuted': False}, indent=2) + '\n')
print(json.dumps({'output': str(OUTPUT), 'revision': PIN['revision'], 'binarySHA256': files['ios'], 'linkedModules': len(module_receipts), 'runtimeExecuted': False}))
