"""Build Tibo Reset using system developer tools; no npm runtime dependencies."""
from pathlib import Path
import subprocess
import shutil
import os
import argparse
import sys
import json
import plistlib

parser = argparse.ArgumentParser()
parser.add_argument('--platform', choices=['macos', 'windows'], default='windows' if sys.platform == 'win32' else 'macos')
platform = parser.parse_args().platform

root = Path(__file__).resolve().parents[1]
target = root / ('.build/TiboReset-Windows' if platform == 'windows' else '.build/TiboReset')
(target / 'native').mkdir(parents=True, exist_ok=True)
files = ['settings.js', 'announcements.js', 'x-collector.js', 'x-monitor.js', 'sidebar.js', 'connection.js', 'startup.js', 'menu-transport.js', 'main.js']
(target / 'app.cjs').write_bytes(('"use strict";\n' + '\n'.join((root / 'src' / name).read_text(encoding='utf-8') for name in files)).encode('utf-8'))
for name in ['manage.cjs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'ORIGINS.md', 'settings.example.json',
             'docs/DEVELOPMENT.md', 'docs/DELIVERY.md', 'docs/COMPATIBILITY.md']:
    (target / name).parent.mkdir(parents=True, exist_ok=True)
    if (root / name).exists(): shutil.copy2(root / name, target / name)
(target / 'native/collector.js').write_bytes(((root / 'src/x-collector.js').read_text(encoding='utf-8') + '\ninstallXCollector();\n').encode('utf-8'))
if platform == 'windows':
    (target / 'windows').mkdir(exist_ok=True)
    for source in (root / 'windows').iterdir():
        if source.suffix == '.ps1': (target / 'windows' / source.name).write_bytes(source.read_text(encoding='utf-8').encode('utf-8-sig'))
        elif source.suffix in ['.cjs', '.json']: shutil.copy2(source, target / 'windows' / source.name)
    for title, action in [('install.cmd','install'), ('status.cmd','status'), ('launch-codex.cmd','launch'), ('uninstall.cmd','uninstall')]:
        (target / title).write_bytes(('@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\\bootstrap.ps1" -Action ' + action + '\r\nset "TIBO_EXIT=%ERRORLEVEL%"\r\npause\r\nexit /b %TIBO_EXIT%\r\n').encode('utf-8'))
    print('Built', target)
    raise SystemExit(0)
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
parts = []
sources = [root / 'native/MenuBarModel.swift', root / 'native/MenuBar.swift']
for arch in ['arm64', 'x86_64']:
    part = root / '.build' / ('menubar-' + arch)
    if not part.exists() or any(source.stat().st_mtime > part.stat().st_mtime for source in sources):
        subprocess.run(['xcrun', 'swiftc', '-O', '-target', arch + '-apple-macos14.0', *map(str, sources), '-o', str(part)], check=True)
    parts.append(str(part))
app = target / 'Tibo Reset.app'
if app.exists(): shutil.rmtree(app)
macos = app / 'Contents/MacOS'; macos.mkdir(parents=True)
resources = app / 'Contents/Resources'; resources.mkdir()
subprocess.run(['lipo', '-create', *parts, '-output', str(macos / 'TiboReset')], check=True)
icon = root / '.build/TiboReset.icns'
if not icon.exists() or (root / 'native/AppIcon.swift').stat().st_mtime > icon.stat().st_mtime:
    iconset = root / '.build/TiboReset.iconset'
    subprocess.run(['xcrun', 'swift', str(root / 'native/AppIcon.swift'), str(iconset)], check=True)
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(icon)], check=True)
shutil.copy2(icon, resources / 'TiboReset.icns')
version = json.loads((root / 'package.json').read_text())['version']
(app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
    'CFBundleName': 'Tibo Reset', 'CFBundleDisplayName': 'Tibo Reset', 'CFBundleIdentifier': 'com.tiboreset.menubar',
    'CFBundleExecutable': 'TiboReset', 'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': version,
    'CFBundleVersion': version, 'LSMinimumSystemVersion': '14.0', 'LSUIElement': True,
    'NSHighResolutionCapable': True,
    'CFBundleIconFile': 'TiboReset',
}))
shutil.copy2(target / 'app.cjs', resources / 'app.cjs')
shutil.copytree(target / 'native', resources / 'native')
subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', str(app)], check=True)
for title, action in [('安装.command','install'), ('诊断.command','status'), ('启动Codex.command','launch'), ('卸载.command','uninstall')]:
    (target / title).write_bytes('''#!/bin/zsh
set -e
cd "${0:A:h}"
runtime="$HOME/Library/Application Support/TiboReset/runtime/node"
if [[ -x "$runtime" ]]; then exec "$runtime" manage.cjs ACTION "$@"; fi
for client in /Applications/Codex.app /Applications/ChatGPT.app "$HOME/Applications/Codex.app" "$HOME/Applications/ChatGPT.app"; do
  runtime="$client/Contents/Resources/cua_node/bin/node"
  if [[ -x "$runtime" ]]; then exec "$runtime" manage.cjs ACTION "$@"; fi
done
print -u2 "找不到桌面客户端内置运行环境。"
exit 1
'''.replace('ACTION', action).encode('utf-8'))
    os.chmod(target / title, 0o755)
print('Built', target)
