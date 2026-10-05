"""Prime only this checkout's SwiftPM artifact cache with the pinned archive.

SwiftPM still performs its own binaryTarget checksum validation. Using a bounded
curl download avoids unbounded URLSession stalls in development environments.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import os

root = Path(__file__).resolve().parent.parent
pin = json.loads((root / 'config/sparkle.json').read_text())
cache = root / '.build/swift-cache/artifacts'
cache.mkdir(parents=True, exist_ok=True)
target = cache / re.sub(r'[^A-Za-z0-9_]', '_', pin['url'])
if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == pin['sha256']:
    print('Verified pinned Sparkle artifact cache.')
else:
    fd, path = tempfile.mkstemp(prefix='sparkle-download-', dir=cache)
    os.close(fd)
    try:
        subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '180', '--output', path, pin['url']], check=True)
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == pin['sha256'], 'Sparkle artifact checksum mismatch'
        os.replace(path, target)
    finally:
        if Path(path).exists(): Path(path).unlink()
    print('Downloaded and verified pinned Sparkle artifact.')
