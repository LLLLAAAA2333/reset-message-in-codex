"""Cross-publish the native Windows tray app; all toolchains stay in .build/."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
import re

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.build/toolchains'
SPEC = json.loads((ROOT / 'windows/toolchain.json').read_text())


def download(url, path, digest, algorithm='sha256'):
    if path.exists() and hashlib.new(algorithm, path.read_bytes()).hexdigest() == digest.lower():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.download')
    print('Downloading', path.name, flush=True)
    hasher = hashlib.new(algorithm)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as out:
            while block := response.read(1024 * 1024):
                hasher.update(block); out.write(block)
        if hasher.hexdigest() != digest.lower():
            raise RuntimeError('Checksum mismatch: ' + path.name)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def sdk():
    existing = os.environ.get('TIBO_DOTNET') or shutil.which('dotnet')
    if existing:
        version = subprocess.check_output([existing, '--version'], text=True).strip()
        if version == SPEC['sdkVersion']:
            return Path(existing).resolve()
    target = CACHE / ('dotnet-' + SPEC['sdkVersion'])
    binary = target / ('dotnet.exe' if sys.platform == 'win32' else 'dotnet')
    if binary.exists():
        return binary
    rid = ('osx-' if sys.platform == 'darwin' else 'linux-') + ('arm64' if platform.machine().lower() in ['arm64', 'aarch64'] else 'x64')
    info = SPEC.get(rid)
    if not info:
        raise RuntimeError('Install official .NET SDK ' + SPEC['sdkVersion'] + ' or set TIBO_DOTNET. No pinned SDK for ' + rid)
    archive = download(info['url'], CACHE / (rid + '-' + SPEC['sdkVersion'] + '.tar.gz'), info['sha512'], 'sha512')
    staging = target.with_name(target.name + '.extract')
    if staging.exists(): shutil.rmtree(staging)
    staging.mkdir(parents=True)
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        for member in members:
            destination = (staging / member.name).resolve()
            if not destination.is_relative_to(staging.resolve()) or member.isdev(): raise RuntimeError('Unsafe SDK archive member')
            if member.issym() or member.islnk():
                link = (destination.parent if member.issym() else staging) / member.linkname
                if not link.resolve().is_relative_to(staging.resolve()): raise RuntimeError('Unsafe SDK archive link')
        tar.extractall(staging, members=members)
    staging.rename(target)
    return binary


def environment(dotnet):
    return {**os.environ, 'DOTNET_ROOT': str(dotnet.parent), 'DOTNET_CLI_HOME': str(CACHE / 'dotnet-home'),
            'NUGET_PACKAGES': str(CACHE / 'nuget'), 'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
            'DOTNET_SKIP_FIRST_TIME_EXPERIENCE': '1', 'DOTNET_NOLOGO': '1'}


def pe_machine(file):
    with file.open('rb') as stream:
        if stream.read(2) != b'MZ': raise RuntimeError('Not a Windows executable: ' + file.name)
        stream.seek(0x3c); offset = struct.unpack('<I', stream.read(4))[0]
        stream.seek(offset)
        if stream.read(4) != b'PE\0\0': raise RuntimeError('Invalid PE header')
        return struct.unpack('<H', stream.read(2))[0]


def build(arch, dotnet):
    common = ROOT / '.build/TiboReset-Windows'
    target = ROOT / ('.build/TiboReset-Windows-' + arch)
    if target.exists(): shutil.rmtree(target)
    shutil.copytree(common, target)
    # Build output must never enter the ordinary source tree.
    output = ROOT / ('.build/windows-publish/' + arch)
    obj = ROOT / ('.build/windows-obj/' + arch)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    command = [str(dotnet), 'publish', str(ROOT / 'windows/Tray/TiboReset.csproj'), '-c', 'Release',
               '-r', 'win-' + arch, '--self-contained', 'true', '-o', str(output),
               '-p:BaseIntermediateOutputPath=' + str(obj) + os.sep,
               '-p:BaseOutputPath=' + str(ROOT / ('.build/windows-bin/' + arch)) + os.sep,
               '-p:Version=' + version, '-p:PathMap=' + str(ROOT) + '=/_/src',
               '--configfile', str(ROOT / 'windows/Tray/NuGet.Config')]
    subprocess.run(command, env=environment(dotnet), check=True)
    shutil.copy2(output / 'Tibo Reset.exe', target / 'Tibo Reset.exe')
    node = json.loads((ROOT / 'windows/runtime.json').read_text())
    name = 'node-' + node['version'] + '-win-' + arch
    archive = download('https://nodejs.org/dist/' + node['version'] + '/' + name + '.zip', CACHE / (name + '.zip'), node['sha256'][arch])
    runtime = target / 'runtime'; runtime.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for source, dest in [('node.exe', 'node.exe'), ('LICENSE', 'Node-LICENSE.txt')]:
            (runtime / dest).write_bytes(z.read(name + '/' + source))
    expected = {'x64': 0x8664, 'arm64': 0xaa64}[arch]
    for file in [target / 'Tibo Reset.exe', runtime / 'node.exe']:
        if pe_machine(file) != expected: raise RuntimeError('Wrong executable architecture: ' + str(file))
    notices = target / 'licenses'; notices.mkdir(exist_ok=True)
    for package in ['microsoft.netcore.app.runtime.win-' + arch, 'microsoft.windowsdesktop.app.runtime.win-' + arch]:
        directory = CACHE / 'nuget' / package
        for file in directory.glob('*/*'):
            if file.is_file() and ('license' in file.name.lower() or 'third' in file.name.lower()):
                shutil.copy2(file, notices / (package + '-' + file.name))
    (target / 'build-info.json').write_text(json.dumps({'version': version, 'platform': 'windows', 'arch': arch,
        'sdk': SPEC['sdkVersion'], 'selfContained': True, 'node': node['version'],
        'validation': 'cross-compiled; Windows desktop acceptance pending'}, indent=2) + '\n')
    print('Built and verified PE architecture:', target, flush=True)
    return target


def package(target, arch):
    base = ['Tibo Reset.exe', 'app.cjs', 'native/collector.js', 'README.md', 'LICENSE', 'ORIGINS.md', 'settings.example.json',
            'install.cmd', 'status.cmd', 'launch-codex.cmd', 'uninstall.cmd', 'build-info.json', 'runtime/node.exe', 'runtime/Node-LICENSE.txt']
    base += ['windows/' + name for name in ['bridge.cjs', 'platform.cjs', 'manage.cjs', 'runner.ps1', 'bootstrap.ps1', 'runtime.json']]
    base += ['CHANGELOG.md', 'docs/DEVELOPMENT.md', 'docs/DELIVERY.md', 'docs/COMPATIBILITY.md']
    base += [str(file.relative_to(target)) for file in sorted((target / 'licenses').iterdir()) if file.is_file()]
    payload = {name: (target / name).read_bytes() for name in base}
    for name, content in payload.items():
        # Official Node is bound to a pinned upstream checksum during build.
        if name == 'runtime/node.exe': continue
        if str(ROOT).encode() in content or str(Path.home()).encode() in content or re.search(rb'sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}', content):
            raise RuntimeError('Private build path or possible credential in ' + name)
    payload['SHA256SUMS.txt'] = ''.join(hashlib.sha256(data).hexdigest() + '  ' + name + '\n' for name, data in sorted(payload.items())).encode()
    dist = ROOT / 'dist'; dist.mkdir(exist_ok=True)
    version = json.loads((ROOT / 'package.json').read_text())['version']
    archive = dist / ('TiboReset-Windows-' + arch + '-' + version + '.zip')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in payload.items(): z.writestr('TiboReset/' + name, data)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or set(z.namelist()) != {'TiboReset/' + name for name in payload}: raise RuntimeError('Archive verification failed')
    (dist / ('SHA256SUMS-Windows-' + arch + '.txt')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
    print('Packaged and verified:', archive, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['x64', 'arm64', 'all'], default='all')
    parser.add_argument('--prepare-sdk', action='store_true')
    parser.add_argument('--package', action='store_true')
    parser.add_argument('--test-model', action='store_true')
    args = parser.parse_args()
    dotnet = sdk()
    if args.prepare_sdk:
        subprocess.run([str(dotnet), '--version'], env=environment(dotnet), check=True)
    elif args.test_model:
        subprocess.run([str(dotnet), 'run', '--project', str(ROOT / 'tests/windows-model/WindowsModelTests.csproj'), '-c', 'Release',
            '-p:BaseIntermediateOutputPath=' + str(ROOT / '.build/windows-model-obj') + os.sep,
            '-p:BaseOutputPath=' + str(ROOT / '.build/windows-model-bin') + os.sep,
            '-p:RestoreConfigFile=' + str(ROOT / 'windows/Tray/NuGet.Config')], env=environment(dotnet), check=True)
    else:
        subprocess.run([sys.executable, str(ROOT / 'scripts/build.py'), '--platform', 'windows'], check=True)
        for arch in (['x64', 'arm64'] if args.arch == 'all' else [args.arch]):
            target = build(arch, dotnet)
            if args.package: package(target, arch)
