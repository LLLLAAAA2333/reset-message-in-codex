#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const bundle = fs.existsSync(path.join(__dirname, 'app.cjs')) ? __dirname : path.join(__dirname, '.build/TiboReset');
const api = require(path.join(bundle, 'app.cjs'));
const home = os.homedir(), data = api.DATA_DIR, label = 'com.tiboreset.monitor', domain = `gui/${process.getuid?.()}`;
const plist = path.join(home, 'Library/LaunchAgents', label + '.plist');
const app = path.join(home, 'Applications/Tibo Reset.app');
const appExecutable = path.join(app, 'Contents/MacOS/TiboReset');
const pinnedNode = path.join(data, 'runtime/node');
const runtimeFiles = ['app.cjs', 'manage.cjs', 'native/bridge', 'native/startup', 'native/collector.js'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args, optional = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
  if (!optional && (result.error || result.status !== 0)) throw Error(`${path.basename(command)} 失败：${result.stderr || result.error?.message || result.status}`);
  return result;
}
const ctl = (args, optional = false) => run('/bin/launchctl', args, optional);
const loaded = name => ctl(['print', `${domain}/${name}`], true).status === 0;
async function stopMonitor() {
  if (fs.existsSync(data)) fs.writeFileSync(path.join(data, 'stop.request'), '', { mode: 0o600 });
  const state = ctl(['print', `${domain}/${label}`], true);
  const pid = Number(/^\s*pid = (\d+)\s*$/m.exec(state.stdout || '')?.[1]);
  let menuPid;
  try { menuPid = Number(fs.readFileSync(path.join(data, 'menubar.pid'), 'utf8')); } catch {}
  if (state.status === 0) ctl(['bootout', `${domain}/${label}`]);
  // launchctl may return before the service/process finishes leaving the domain.
  for (let i = 0; i < 40; i++) {
    let alive = false;
    for (const current of [pid, menuPid].filter(p => Number.isInteger(p) && p > 0)) {
      try { process.kill(current, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
    }
    if (!loaded(label) && !alive) { fs.rmSync(path.join(data, 'stop.request'), { force: true }); return; }
    await sleep(250);
  }
  throw Error('原后台仍在退出，暂未替换运行文件');
}
async function startMonitor() {
  for (let i = 0; i < 8; i++) {
    const result = ctl(['bootstrap', domain, plist], true);
    if (result.status === 0) return;
    if (loaded(label) || i === 7) throw Error(`后台启动失败：${result.stderr || result.error?.message || result.status}`);
    await sleep(250);
  }
}
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[c]);
function launchAgent() {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(appExecutable)}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>TIBO_RESET_DATA_DIR</key><string>${escape(data)}</string></dict>
<key>StandardOutPath</key><string>${escape(path.join(data, 'monitor.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(data, 'monitor.err.log'))}</string>
</dict></plist>`;
}
async function evaluateWindows(expression, port = api.readSettings().port) {
  const pages = await api.desktopPages(port).catch(() => []), result = [];
  for (const page of pages) {
    const channel = new api.PageChannel(page, port);
    try { await channel.open(); result.push(await channel.evaluate(expression)); }
    finally { channel.close(); }
  }
  return result;
}
function legacyMigration() {
  // One-time compatibility import. Runtime never opens this directory.
  const old = path.join(home, 'Library/Application Support/CodexUsageBadge');
  if (!fs.existsSync(path.join(old, 'badge-settings.json'))) throw Error('未找到原安装，无法迁移');
  const prior = JSON.parse(fs.readFileSync(path.join(old, 'badge-settings.json'))).resetAnnouncements || {};
  const settings = { port: 39222, xPollSeconds: prior.xPollSeconds || 60, displayTimezone: prior.displayTimezone || 'Asia/Shanghai' };
  for (const key of ['model', 'codexBin', 'proxyUrl', 'foloFeedId']) if (prior[key] !== undefined) settings[key] = prior[key];
  const disabled = ctl(['print-disabled', domain], true).stdout || '';
  const jobs = ['com.codexusagebadge.agent', 'com.codexusagebadge.startup', 'com.codexusagebadge.updater', 'com.codexusagebadge.activate-once', 'com.codexusagebadge.install-once'].map(name => ({
    name, running: loaded(name), disabled: disabled.includes(`"${name}" => true`), file: path.join(home, 'Library/LaunchAgents', name + '.plist')
  }));
  return { old, settings, jobs };
}
async function install(migrate = false) {
  if (process.platform !== 'darwin') throw Error('首版支持 macOS 14+');
  for (const file of runtimeFiles) if (!fs.statSync(path.join(bundle, file)).isFile()) throw Error('安装文件缺失：' + file);
  const sourceApp = path.join(bundle, 'Tibo Reset.app');
  if (!fs.existsSync(path.join(sourceApp, 'Contents/MacOS/TiboReset'))) throw Error('安装包缺少菜单栏 App');
  const migration = migrate ? legacyMigration() : null;
  const runtimeNode = process.execPath || api.findDesktop().node;
  fs.mkdirSync(data, { recursive: true, mode: 0o700 }); fs.mkdirSync(path.dirname(plist), { recursive: true });
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-install-'));
  const files = [...runtimeFiles.map(f => path.join(data, f)), path.join(data, 'settings.json'), path.join(data, 'status.json'), plist];
  const existed = new Set(files.filter(f => fs.existsSync(f)));
  for (const [i, file] of files.entries()) if (existed.has(file)) fs.copyFileSync(file, path.join(backup, String(i)));
  const appExisted = fs.existsSync(app), nodeExisted = fs.existsSync(pinnedNode);
  if (appExisted) fs.cpSync(app, path.join(backup, 'app'), { recursive: true });
  const wasRunning = loaded(label); let switched = false, appReplaced = false, keepBackup = false;
  try {
    await stopMonitor();
    // Health is a process receipt, not cached user data. A fresh app must not
    // mistake the stopped monitor's last receipt for a live collector.
    fs.rmSync(path.join(data, 'status.json'), { force: true });
    for (const file of runtimeFiles) {
      const dest = path.join(data, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (path.resolve(path.join(bundle, file)) !== path.resolve(dest)) fs.copyFileSync(path.join(bundle, file), dest);
      fs.chmodSync(dest, ['native/bridge', 'native/startup'].includes(file) ? 0o700 : 0o600);
    }
    if (!nodeExisted) {
      fs.mkdirSync(path.dirname(pinnedNode), { recursive: true, mode: 0o700 });
      fs.copyFileSync(runtimeNode, pinnedNode + '.tmp'); fs.chmodSync(pinnedNode + '.tmp', 0o700);
      fs.renameSync(pinnedNode + '.tmp', pinnedNode);
    }
    fs.mkdirSync(path.dirname(app), { recursive: true });
    appReplaced = true; fs.rmSync(app, { recursive: true, force: true }); fs.cpSync(sourceApp, app, { recursive: true });
    const settingsFile = path.join(data, 'settings.json');
    if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify(migration?.settings || { port: 39222, xPollSeconds: 60, displayTimezone: 'Asia/Shanghai' }, null, 2), { mode: 0o600 });
    api.readSettings(settingsFile);
    if (migration) {
      switched = true;
      for (const job of migration.jobs) { ctl(['disable', `${domain}/${job.name}`]); if (job.running) ctl(['bootout', `${domain}/${job.name}`], true); }
      // Give the old process time to close WebKit before opening the same named store.
      await sleep(1200);
      for (const [from, to] of [['x-announcements-cache.json','x-announcements-cache.json'], ['reset-announcements-cache.json','feed-cache.json']]) {
        if (fs.existsSync(path.join(migration.old, from)) && !fs.existsSync(path.join(data, to))) { fs.copyFileSync(path.join(migration.old, from), path.join(data, to)); fs.chmodSync(path.join(data, to), 0o600); }
      }
    }
    // Remove any connected old sidebar during the switch; the desktop itself
    // stays running. The menu bar no longer needs a CDP port.
    await evaluateWindows('window.__tiboReset?.destroy()').catch(() => {});
    fs.writeFileSync(plist, launchAgent(), { mode: 0o600 });
    ctl(['enable', `${domain}/${label}`]); const started = Date.now(); await startMonitor();
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(500);
      try { const state = JSON.parse(fs.readFileSync(path.join(data, 'status.json'))); if (state.version === '0.3.0' && state.mode === 'menu-bar' && state.checkedAt >= started && state.startup?.running && state.startup.updatedAt >= started && loaded(label)) { healthy = true; break; } } catch {}
    }
    if (!healthy) throw Error('新后台未正常启动，恢复切换前状态');
    if (migration) {
      await evaluateWindows('(() => { for (const key of ["__codexUsageBadge","__codexProjectColors","__codexProjectSizes","__codexThreadTokens","__codexResetAnnouncements"]) window[key]?.destroy?.(); return true; })()').catch(() => {});
      fs.writeFileSync(path.join(data, 'migration.json'), JSON.stringify({ at: new Date().toISOString(), jobs: migration.jobs, originalFilesRetained: true }, null, 2), { mode: 0o600 });
    }
    console.log(`Tibo Reset 0.3.0 菜单栏 App 已安装：${app}\n登录时自动启动；Codex/ChatGPT 无需重启。X 登录和现有模型设置保留。`);
  } catch (error) {
    try { await stopMonitor(); } catch {
      keepBackup = true; throw Error('后台尚未退出，未覆盖运行中的文件。已保留回滚文件：' + backup);
    }
    for (const [i, file] of files.entries()) { if (existed.has(file)) fs.copyFileSync(path.join(backup, String(i)), file); else fs.rmSync(file, { force: true }); }
    if (appReplaced) { fs.rmSync(app, { recursive: true, force: true }); if (appExisted) fs.cpSync(path.join(backup, 'app'), app, { recursive: true }); }
    if (!nodeExisted) fs.rmSync(pinnedNode, { force: true });
    fs.rmSync(pinnedNode + '.tmp', { force: true });
    if (wasRunning) await startMonitor().catch(() => {});
    if (switched) for (const job of migration.jobs) {
      if (!job.disabled) ctl(['enable', `${domain}/${job.name}`], true);
      if (job.running && fs.existsSync(job.file)) ctl(['bootstrap', domain, job.file], true);
    }
    throw error;
  } finally { if (!keepBackup) fs.rmSync(backup, { recursive: true, force: true }); }
}
async function status() {
  let health = null;
  try { health = JSON.parse(fs.readFileSync(path.join(data, 'status.json'))); } catch {}
  console.log(JSON.stringify({ running: loaded(label), data, app, health,
    windows: api.readSettings().sidebarEnabled ? await evaluateWindows('window.__tiboReset?.status() ?? null').catch(() => []) : [] }, null, 2));
}
async function launch() {
  const settings = api.readSettings(), desktop = api.findDesktop(settings.appPath);
  if ((await api.desktopPages(settings.port).catch(() => [])).length) { run('/usr/bin/open', ['-a', desktop.app]); return; }
  const executable = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(desktop.app, 'Contents/Info.plist')]).stdout.trim();
  if (!executable || /[/\r\n]/.test(executable)) throw Error('客户端程序名无效');
  if (run('/usr/bin/pgrep', ['-x', executable], true).status === 0) throw Error('Codex 正在运行但未启用侧边栏连接。请先自行退出客户端，再运行“启动Codex.command”；不会自动关闭你的会话。');
  run('/usr/bin/open', ['-a', desktop.app, '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${settings.port}`]);
}
async function uninstall() {
  ctl(['disable', `${domain}/${label}`], true); await stopMonitor();
  await evaluateWindows('window.__tiboReset?.destroy()').catch(() => {});
  fs.rmSync(plist, { force: true });
  fs.rmSync(app, { recursive: true, force: true });
  // Keep login/cache/settings for recovery; uninstall never clears another app's X session.
  console.log('Tibo Reset 菜单栏 App、后台与侧边栏已停用。本地数据保留在：' + data);
}
module.exports = { launchAgent, legacyMigration, evaluateWindows, install, status, launch, uninstall };
if (require.main === module) {
  const action = process.argv[2];
  const work = action === 'install' ? () => install(process.argv.includes('--import-badge')) : { status, launch, uninstall }[action];
  if (!work) { console.error('用法：manage.cjs install [--import-badge] | status | launch | uninstall'); process.exitCode = 1; }
  else Promise.resolve().then(work).catch(error => { console.error(error.message); process.exitCode = 1; });
}
