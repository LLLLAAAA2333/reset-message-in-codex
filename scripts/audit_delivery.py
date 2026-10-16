"""Verify built delivery artifacts without inspecting any user settings or X data."""
from pathlib import Path
import argparse
import datetime
import hashlib
import io
import json
import os
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']


def archive_check(path, checksum):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if checksum.read_text().split()[0] != digest: raise RuntimeError('Outer checksum mismatch: ' + path.name)
    with zipfile.ZipFile(path) as z:
        if z.testzip() is not None: raise RuntimeError('Corrupt ZIP')
        names = z.namelist()
        for name in names:
            leaf = Path(name).name.lower()
            if not name.startswith('TiboReset/') or '..' in Path(name).parts or leaf in ['settings.json', 'status.json', 'menubar.pid', 'menubar.lock', 'x-session-ready', 'x-bridge.lock', 'tray-settings.json'] or leaf.endswith('.log') or '-cache.json' in leaf:
                raise RuntimeError('Unexpected user-data path: ' + name)
        manifest = z.read('TiboReset/SHA256SUMS.txt').decode()
        expected = set()
        for line in manifest.splitlines():
            sha, name = line.split('  ', 1); expected.add('TiboReset/' + name)
            if hashlib.sha256(z.read('TiboReset/' + name)).hexdigest() != sha: raise RuntimeError('Inner checksum mismatch: ' + name)
        if set(names) != expected | {'TiboReset/SHA256SUMS.txt'}: raise RuntimeError('Unlisted archive members')
    return {'file': path.name, 'sha256': digest, 'sizeMiB': round(len(data) / 1024 / 1024, 1), 'checksumsValid': True, 'noUserData': True}


def pe(data):
    if data[:2] != b'MZ': raise RuntimeError('Missing Windows PE')
    offset = struct.unpack_from('<I', data, 0x3c)[0]
    if data[offset:offset + 4] != b'PE\0\0': raise RuntimeError('Invalid Windows PE')
    machine = struct.unpack_from('<H', data, offset + 4)[0]
    optional = offset + 24
    if struct.unpack_from('<H', data, optional)[0] != 0x20b: raise RuntimeError('Expected PE32+ executable')
    return machine, struct.unpack_from('<H', data, optional + 68)[0], struct.unpack_from('<I', data, optional + 112 + 4 * 8 + 4)[0] > 0


def windows(arch):
    path = ROOT / ('dist/TiboReset-Windows-' + arch + '-' + VERSION + '.zip')
    result = archive_check(path, ROOT / ('dist/SHA256SUMS-Windows-' + arch + '.txt'))
    with zipfile.ZipFile(path) as z:
        native = z.read('TiboReset/Tibo Reset.exe'); node = z.read('TiboReset/runtime/node.exe')
        machine, subsystem, signed = pe(native)
        expected = {'x64': 0x8664, 'arm64': 0xaa64}[arch]
        if machine != expected or pe(node)[0] != expected or subsystem != 2: raise RuntimeError('Windows app architecture or GUI subsystem mismatch')
        spec = json.loads((ROOT / 'windows/runtime.json').read_text())
        source = ROOT / ('.build/toolchains/node-' + spec['version'] + '-win-' + arch + '.zip')
        if hashlib.sha256(source.read_bytes()).hexdigest() != spec['sha256'][arch]: raise RuntimeError('Official Node checksum mismatch')
        with zipfile.ZipFile(source) as upstream:
            if node != upstream.read('node-' + spec['version'] + '-win-' + arch + '/node.exe'): raise RuntimeError('Packaged Node differs from verified upstream')
        licenses = [n for n in z.namelist() if n.startswith('TiboReset/licenses/')]
        if len(licenses) < 3 or 'TiboReset/runtime/Node-LICENSE.txt' not in z.namelist(): raise RuntimeError('Runtime license missing')
        info = json.loads(z.read('TiboReset/build-info.json'))
        if not info['selfContained'] or info['arch'] != arch: raise RuntimeError('Build metadata mismatch')
    result.update({'arch': arch, 'nativeGuiExecutable': True, 'selfContained': True, 'nodeMatchesPinnedOfficialBuild': True,
                   'runtimeLicenseFiles': len(licenses) + 1, 'authenticodeSignaturePresent': signed,
                   'windowsDesktopAcceptance': 'not_run', 'publicDeliveryReady': False,
                   'pending': ['Windows 11 interactive desktop and X login acceptance', 'startup, upgrade and uninstall acceptance on Windows', 'Authenticode signing and distribution trust verification']})
    return result


def macos():
    result = archive_check(ROOT / ('dist/TiboReset-macOS-' + VERSION + '.zip'), ROOT / 'dist/SHA256SUMS.txt')
    app = ROOT / '.build/TiboReset/Tibo Reset.app'
    verified = subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], capture_output=True).returncode == 0
    if not verified: raise RuntimeError('macOS bundle signature integrity failed')
    archs = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS/TiboReset')], text=True).split()
    if set(archs) != {'x86_64', 'arm64'}: raise RuntimeError('Missing macOS architecture')
    trusted = subprocess.run(['spctl', '--assess', '--type', 'execute', str(app)], capture_output=True).returncode == 0
    result.update({'architectures': archs, 'bundleIntegrityValid': verified, 'gatekeeperAccepted': trusted,
                   'internalTestCandidate': True, 'publicDeliveryReady': False,
                   'pending': ['Developer ID signing and Apple notarization', 'clean-machine install and signed-upgrade acceptance', 'Intel hardware acceptance']})
    return result


def test(name, command, env):
    print('Running', name, flush=True)
    run = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
    lines = [line for line in run.stdout.splitlines() if line.startswith('PASS')]
    if run.returncode != 0:
        print(run.stdout[-8000:]); print(run.stderr[-8000:]); raise RuntimeError(name + ' failed')
    return {'passed': True, 'checks': lines}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--run-tests', action='store_true'); args = parser.parse_args()
    report = {'version': VERSION, 'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'host': sys.platform}
    if args.run_tests:
        env = dict(os.environ); env['TIBO_TEST_WINDOWS'] = '1'
        chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        if Path(chrome).exists(): env.setdefault('PLAYWRIGHT_EXECUTABLE_PATH', chrome)
        report['tests'] = {'macAndWindowsSource': test('application regression and Windows source fixtures', ['npm', 'test'], env),
                           'windowsPresentation': test('Windows C# presentation model', [sys.executable, 'scripts/windows_app.py', '--test-model'], env)}
    report['macos'] = macos()
    report['windows'] = [windows(arch) for arch in ['x64', 'arm64']]
    target = ROOT / '.build/delivery-audit.json'; target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('Verified all three archives, manifests, executables and runtime licenses.')
    print('Public delivery: NOT READY; see pending signing and target-machine acceptance checks.')
    print('Report:', target)
