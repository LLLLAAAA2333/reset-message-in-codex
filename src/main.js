async function main() {
  const settings = readSettings();
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (settings.proxyUrl) {
    if (!require('node:http').setGlobalProxyFromEnv) throw Error('内置 Node 需要 24.14 或更新版本');
    require('node:http').setGlobalProxyFromEnv({ HTTP_PROXY: settings.proxyUrl, HTTPS_PROXY: settings.proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1' });
  }
  const desktop = findDesktop(settings.appPath), host = new SidebarHost(settings.port);
  const startup = startIconWatcher(desktop, settings);
  const monitor = new XAnnouncementMonitor({ ...settings, cacheFile: path.join(DATA_DIR, 'x-announcements-cache.json'),
    parse: createCodexResetParser({ command: settings.codexBin || desktop.codex, model: settings.model, proxyUrl: settings.proxyUrl }),
    onChange: snapshot => host.update(snapshot) });
  host.snapshot = monitor.snapshot();
  let stopping = false, busy = false;
  const health = () => {
    const value = { version: '0.2.0', checkedAt: Date.now(), connectedWindows: host.channels.size, startup: startup.status(),
      xState: monitor.state, xCheckedAt: monitor.checkedAt, records: monitor.snapshot().records.length, unread: monitor.unread.length };
    const target = path.join(DATA_DIR, 'status.json');
    fs.writeFileSync(target + '.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(target + '.tmp', target);
  };
  const tick = async () => {
    if (busy || stopping) return;
    if (process.platform === 'win32' && fs.existsSync(path.join(DATA_DIR, 'stop.request'))) { await stop(); return; }
    busy = true;
    try {
      monitor.tick().catch(() => {});
      await host.scan();
      for (const action of await host.actions()) await monitor.action(action);
      health();
    } catch { process.stderr.write('Tibo Reset: 本次刷新未完成，稍后重试\n'); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 5000);
  const stop = async () => {
    if (stopping) return; stopping = true; clearInterval(timer); await monitor.stop(); startup.stop();
    await host.close(); process.exit(0);
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await tick();
}
module.exports = { readSettings, findDesktop, DATA_DIR, PageChannel, SidebarHost, desktopPages, isCodexPage,
  installTiboSidebar, createCodexResetParser, validateResetResult, parseResetFeed, resetPostUrl, isResetCandidate,
  ResetAnnouncementMonitor, XAnnouncementMonitor, extractXTimeline };
if (require.main === module) main().catch(error => { process.stderr.write(`Tibo Reset: ${error.message}\n`); process.exitCode = 1; });
