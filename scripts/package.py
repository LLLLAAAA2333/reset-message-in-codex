"""Package only the independently built runtime, never user data."""
from pathlib import Path
import subprocess
import sys
import hashlib
import zipfile
import re

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/build.py')], check=True)
source = root / '.build/TiboReset'
names = ['app.cjs', 'manage.cjs', 'native/bridge', 'native/startup', 'native/collector.js', 'README.md', 'LICENSE', 'ORIGINS.md', 'settings.example.json', '安装.command', '诊断.command', '启动Codex.command', '卸载.command']
payload = {name: (source / name).read_bytes() for name in names}
for name, content in payload.items():
    if re.search(rb'/Users/[A-Za-z0-9_. -]+/|/Volumes/[^\s"\x00]+|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}', content):
        raise SystemExit('Private path or possible credential in package: ' + name)
manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(payload.items()))
payload['SHA256SUMS.txt'] = manifest.encode()
dest = root / 'dist'; dest.mkdir(exist_ok=True)
archive = dest / 'TiboReset-macOS-0.1.1.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, content in payload.items():
        info = zipfile.ZipInfo('TiboReset/' + name)
        info.external_attr = (0o100755 if name.endswith('.command') or name in ['native/bridge', 'native/startup'] else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, content)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert set(z.namelist()) == {'TiboReset/' + name for name in payload}
(dest / 'SHA256SUMS.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print('Packaged and verified:', archive)
