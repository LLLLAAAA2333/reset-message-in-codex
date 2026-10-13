'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
function powershell(script) {
  // A PowerShell 7 parent can leave Windows PowerShell 5.1 with incompatible module paths.
  script = "$env:PSModulePath = $PSHOME + '\\Modules;' + $env:PSModulePath\n$ProgressPreference = 'SilentlyContinue'\n" + script;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (result.error || result.status !== 0) throw Error('Windows 操作未完成：' + (result.error?.message || result.stderr?.trim() || result.status));
  return result.stdout.trim();
}
function findFile(root, names, depth = 0) {
  if (depth > 6 || !fs.existsSync(root)) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) if (entry.isFile() && names.has(entry.name.toLowerCase())) return path.join(root, entry.name);
  for (const entry of entries) if (entry.isDirectory()) { const found = findFile(path.join(root, entry.name), names, depth + 1); if (found) return found; }
  return null;
}
function appCandidates() {
  const candidates = [];
  try {
    const output = powershell(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$items = @(Get-AppxPackage | Where-Object { $_.Name -match '(Codex|ChatGPT|OpenAI)' } | ForEach-Object {
  $package = $_
  $manifest = Get-AppxPackageManifest -Package $package.PackageFullName
  foreach ($app in $manifest.Package.Applications.Application) {
    if ($app.Executable -and $app.Executable -match '(Codex|ChatGPT)') {
      Join-Path $package.InstallLocation $app.Executable
    }
  }
})
ConvertTo-Json -InputObject $items -Compress`);
    candidates.push(...JSON.parse(output || '[]'));
  } catch {}
  for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    for (const name of ['Codex', 'ChatGPT']) candidates.push(path.join(base, name, name + '.exe'));
  }
  return candidates;
}
function findDesktop(settings = {}) {
  const candidates = settings.appPath ? [settings.appPath] : appCandidates();
  for (const app of candidates) {
    if (!/\.exe$/i.test(app) || !fs.existsSync(app) || !fs.statSync(app).isFile()) continue;
    const base = path.dirname(app), resources = path.join(base, 'resources');
    const codex = settings.codexBin || findFile(resources, new Set(['codex.exe', 'codex-x64.exe', 'codex-arm64.exe']));
    if (codex && /\.exe$/i.test(codex) && fs.existsSync(codex) && path.resolve(codex).toLowerCase() !== path.resolve(app).toLowerCase()) {
      return { app: path.resolve(app), codex: path.resolve(codex), node: process.execPath };
    }
  }
  throw Error('未找到 Windows 桌面程序及其原生 Codex CLI。请在 settings.json 指定 appPath（桌面 .exe）和 codexBin（CLI .exe）。');
}
function findEdge(explicit) {
  const candidates = explicit ? [explicit] : [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
    .map(base => path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
  const result = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!result) throw Error('未找到 Microsoft Edge，请安装 Edge 或在 settings.json 设置 edgePath。');
  return result;
}
function mutexName(data) { return 'Local\\TiboReset-' + crypto.createHash('sha256').update(path.resolve(data).toLowerCase()).digest('hex').slice(0, 24); }
function isRunning(data) {
  return powershell(`try { $m = [Threading.Mutex]::OpenExisting(${quote(mutexName(data))}); $m.Dispose(); 'true' } catch [Threading.WaitHandleCannotBeOpenedException] { 'false' }`) === 'true';
}
function shortcutPaths() {
  return JSON.parse(powershell(`[Console]::OutputEncoding = [Text.Encoding]::UTF8
@{ startup = [Environment]::GetFolderPath('Startup'); desktop = [Environment]::GetFolderPath('Desktop') } | ConvertTo-Json -Compress`));
}
module.exports = { quote, powershell, findDesktop, findEdge, mutexName, isRunning, shortcutPaths, findFile };
