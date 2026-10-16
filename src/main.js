async function main() {
  const settings = readSettings();
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (settings.proxyUrl) {
    if (!require('node:http').setGlobalProxyFromEnv) throw Error('内置 Node 需要 24.14 或更新版本');
    require('node:http').setGlobalProxyFromEnv({ HTTP_PROXY: settings.proxyUrl, HTTPS_PROXY: settings.proxyUrl, NO_PROXY: 'localhost,127.0.0.1,::1' });
  }
  const stdio = process.argv.includes('--stdio');
  const host = settings.sidebarEnabled && !process.argv.includes('--standalone') ? new SidebarHost(settings.port) : null;
  const presentation = process.platform === 'win32' ? 'tray' : 'menu-bar';
  const startup = host ? startIconWatcher(findDesktop(settings.appPath), settings) : {
    status: () => ({ running: true, mode: presentation, updatedAt: started }), stop() {}
  };
  const started = Date.now();
  let transport, stopping = false, busy = false;
  const monitor = new XAnnouncementMonitor({ ...settings, cacheFile: path.join(DATA_DIR, 'x-announcements-cache.json'),
    // Resolve the CLI afresh for each batch, so replacing the desktop app cannot
    // stop collection or leave a permanently stale CLI path.
    parse: (posts, signal) => createCodexResetParser({ command: findCodex(settings), model: settings.model, proxyUrl: settings.proxyUrl })(posts, signal),
    onChange: snapshot => { transport?.update(snapshot); return host?.update(snapshot); } });
  if (host) host.snapshot = monitor.snapshot();
  const health = () => {
    const value = { version: '0.3.0', pid: process.pid, checkedAt: Date.now(), mode: stdio ? presentation : 'monitor', connectedWindows: host?.channels.size || 0, startup: startup.status(),
      xState: monitor.state, xCheckedAt: monitor.checkedAt, records: monitor.snapshot().records.length, unread: monitor.unread.length };
    const target = path.join(DATA_DIR, 'status.json');
    fs.writeFileSync(target + '.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(target + '.tmp', target);
  };
  const tick = async () => {
    if (busy || stopping) return;
    if (fs.existsSync(path.join(DATA_DIR, 'stop.request'))) { await stop(); return; }
    busy = true;
    try {
      monitor.tick().catch(() => {});
      if (host) {
        await host.scan();
        for (const action of await host.actions()) await monitor.action(action);
      }
      transport?.update(monitor.snapshot());
      health();
    } catch { process.stderr.write('Tibo Reset: 本次刷新未完成，稍后重试\n'); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 5000);
  const stop = async () => {
    if (stopping) return; stopping = true; clearInterval(timer); await monitor.stop(); startup.stop();
    transport?.close(); await host?.close(); process.exit(0);
  };
  if (stdio) {
    transport = new MenuBarTransport({ onAction: action => action === 'stop' ? stop() : action === 'wake' ? monitor.wake() : monitor.action(action), onClose: stop });
    transport.update(monitor.snapshot());
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await tick();
}
module.exports = { readSettings, findDesktop, findCodex, MenuBarTransport, DATA_DIR, PageChannel, SidebarHost, desktopPages, isCodexPage,
  installTiboSidebar, createCodexResetParser, validateResetResult, parseResetFeed, resetPostUrl, isResetCandidate,
  ResetAnnouncementMonitor, XAnnouncementMonitor, extractXTimeline };
if (require.main === module) main().catch(error => { process.stderr.write(`Tibo Reset: ${error.message}\n`); process.exitCode = 1; });
