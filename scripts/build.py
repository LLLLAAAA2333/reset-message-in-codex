"""Build Tibo Reset using system developer tools; no npm runtime dependencies."""
from pathlib import Path
import subprocess
import shutil
import os

root = Path(__file__).resolve().parents[1]
target = root / '.build/TiboReset'
(target / 'native').mkdir(parents=True, exist_ok=True)
files = ['settings.js', 'announcements.js', 'x-collector.js', 'x-monitor.js', 'sidebar.js', 'connection.js', 'startup.js', 'main.js']
(target / 'app.cjs').write_text('"use strict";\n' + '\n'.join((root / 'src' / name).read_text() for name in files))
for name in ['manage.cjs', 'README.md', 'LICENSE', 'ORIGINS.md', 'settings.example.json']:
    if (root / name).exists(): shutil.copy2(root / name, target / name)
(target / 'native/collector.js').write_text((root / 'src/x-collector.js').read_text() + '\ninstallXCollector();\n')
parts = []
source = root / 'native/XSource.swift'
for arch in ['arm64', 'x86_64']:
    part = root / '.build' / ('source-' + arch)
    if not part.exists() or source.stat().st_mtime > part.stat().st_mtime:
        subprocess.run(['xcrun', 'swiftc', '-O', '-target', arch + '-apple-macos14.0', str(source), '-o', str(part)], check=True)
    parts.append(str(part))
subprocess.run(['lipo', '-create', *parts, '-output', str(target / 'native/bridge')], check=True)
# Keep the helper basename stable: WebKit namespaces its named stores under
# the process name. "bridge" preserves the existing dedicated login on migration.
subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(target / 'native/bridge')], check=True)
parts = []
sources = [root / 'native/StartupPolicy.swift', root / 'native/Startup.swift']
for arch in ['arm64', 'x86_64']:
    part = root / '.build' / ('startup-' + arch)
    if not part.exists() or any(source.stat().st_mtime > part.stat().st_mtime for source in sources):
        subprocess.run(['xcrun', 'swiftc', '-O', '-target', arch + '-apple-macos14.0', *map(str, sources), '-o', str(part)], check=True)
    parts.append(str(part))
subprocess.run(['lipo', '-create', *parts, '-output', str(target / 'native/startup')], check=True)
subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(target / 'native/startup')], check=True)
for title, action in [('安装.command','install'), ('诊断.command','status'), ('启动Codex.command','launch'), ('卸载.command','uninstall')]:
    (target / title).write_text('''#!/bin/zsh
set -e
cd "${0:A:h}"
for client in /Applications/Codex.app /Applications/ChatGPT.app "$HOME/Applications/Codex.app" "$HOME/Applications/ChatGPT.app"; do
  runtime="$client/Contents/Resources/cua_node/bin/node"
  if [[ -x "$runtime" ]]; then exec "$runtime" manage.cjs ACTION "$@"; fi
done
print -u2 "找不到桌面客户端内置运行环境。"
exit 1
'''.replace('ACTION', action))
    os.chmod(target / title, 0o755)
print('Built', target)
