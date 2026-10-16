const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const api = require('../.build/TiboReset/app.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-install-test-'));
async function scenario(failNew) {
  const home = path.join(temp, failNew ? 'rollback' : 'success'), bundle = path.join(home, 'package'), data = path.join(home, 'Library/Application Support/TiboReset');
  const old = path.join(home, 'Library/Application Support/CodexUsageBadge'), jobs = path.join(home, 'Library/LaunchAgents');
  for (const dir of [old, jobs, path.join(bundle, 'native'), path.join(bundle, 'Tibo Reset.app/Contents/MacOS')]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'status.json'), JSON.stringify({ version: '0.1.1', checkedAt: Date.now(), xState: 'ready' }));
  for (const file of ['app.cjs', 'manage.cjs', 'native/bridge', 'native/startup', 'native/collector.js']) fs.writeFileSync(path.join(bundle, file), '// fixture');
  fs.writeFileSync(path.join(bundle, 'Tibo Reset.app/Contents/MacOS/TiboReset'), '// fixture');
  const fixtureNode = path.join(home, 'fixture-node'); fs.writeFileSync(fixtureNode, '// fixture runtime');
  fs.writeFileSync(path.join(old, 'badge-settings.json'), JSON.stringify({ features: { threadTokens: true }, resetAnnouncements: { xPollSeconds: 90, proxyUrl: 'http://127.0.0.1:6578' } }));
  fs.writeFileSync(path.join(old, 'x-announcements-cache.json'), '{"posts":[],"unread":[]}');
  const legacy = ['com.codexusagebadge.agent', 'com.codexusagebadge.startup', 'com.codexusagebadge.updater'];
  const running = new Set(legacy), disabled = new Set();
  let pendingUnload = 0;
  for (const label of legacy) fs.writeFileSync(path.join(jobs, label + '.plist'), '<plist/>');
  const fakeSpawn = (command, args) => {
    assert.equal(command, '/bin/launchctl');
    const [action, destination] = args, label = destination?.split('/').at(-1);
    const ok = { status: 0, stdout: '', stderr: '' };
    if (action === 'print') {
      if (label === 'com.tiboreset.monitor' && pendingUnload && --pendingUnload === 0) running.delete(label);
      return { ...ok, status: running.has(label) ? 0 : 1 };
    }
    if (action === 'print-disabled') return { ...ok, stdout: [...disabled].map(v => `"${v}" => true`).join('\n') };
    if (action === 'disable') disabled.add(label);
    if (action === 'enable') disabled.delete(label);
    if (action === 'bootout') {
      if (label === 'com.tiboreset.monitor' && running.has(label)) pendingUnload = 3;
      else running.delete(label);
    }
    if (action === 'bootstrap') {
      const job = path.basename(args[2], '.plist');
      assert.ok(job !== 'com.tiboreset.monitor' || !pendingUnload, 'Wait for launchd unload before bootstrapping');
      if (job === 'com.tiboreset.monitor') assert.ok(!fs.existsSync(path.join(data, 'status.json')), 'Remove the stopped monitor receipt before starting the new app');
      if (failNew && job === 'com.tiboreset.monitor') return { ...ok, status: 1, stderr: 'fixture bootstrap failure' };
      running.add(job);
      if (job === 'com.tiboreset.monitor') fs.writeFileSync(path.join(data, 'status.json'), JSON.stringify({ version: '0.3.0', mode: 'menu-bar', checkedAt: Date.now(), startup: { running: true, updatedAt: Date.now() } }));
    }
    return ok;
  };
  const fakeApi = { ...api, DATA_DIR: data, findDesktop: () => ({ node: fixtureNode }), desktopPages: async () => [], readSettings: file => api.readSettings(file || path.join(data, 'settings.json')) };
  const load = name => name === 'node:os' ? { ...os, homedir: () => home } : name === 'node:child_process' ? { spawnSync: fakeSpawn } : name.endsWith('/app.cjs') ? fakeApi : require(name);
  load.main = null;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../manage.cjs'), 'utf8'), { require: load, module, __dirname: bundle, process: { platform: 'darwin', getuid: () => 501 }, setTimeout, console: { log() {}, error() {} } });
  if (failNew) {
    await assert.rejects(module.exports.install(true), /fixture bootstrap failure/);
    for (const job of legacy) { assert.ok(running.has(job)); assert.ok(!disabled.has(job)); }
    assert.ok(!running.has('com.tiboreset.monitor')); assert.ok(!fs.existsSync(path.join(jobs, 'com.tiboreset.monitor.plist')));
    assert.ok(!fs.existsSync(path.join(home, 'Applications/Tibo Reset.app')));
    assert.ok(!fs.existsSync(path.join(data, 'runtime/node')));
  } else {
    await module.exports.install(true);
    for (const job of legacy) { assert.ok(!running.has(job)); assert.ok(disabled.has(job)); }
    assert.ok(running.has('com.tiboreset.monitor'));
    const config = JSON.parse(fs.readFileSync(path.join(data, 'settings.json')));
    assert.equal(config.xPollSeconds, 90); assert.equal(config.features, undefined);
    assert.equal(fs.readFileSync(path.join(data, 'x-announcements-cache.json'), 'utf8'), '{"posts":[],"unread":[]}');
    assert.equal(fs.statSync(path.join(data, 'settings.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(data, 'native/startup')).mode & 0o777, 0o700);
    assert.ok(fs.existsSync(path.join(data, 'migration.json')));
    assert.ok(fs.existsSync(path.join(home, 'Applications/Tibo Reset.app/Contents/MacOS/TiboReset')));
    assert.equal(fs.statSync(path.join(data, 'runtime/node')).mode & 0o777, 0o700);
    assert.match(fs.readFileSync(path.join(jobs, 'com.tiboreset.monitor.plist'), 'utf8'), /Applications\/Tibo Reset.app\/Contents\/MacOS\/TiboReset/);
    assert.doesNotMatch(fs.readFileSync(path.join(jobs, 'com.tiboreset.monitor.plist'), 'utf8'), /fixture-node/);
    fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ ...config, model: 'user-selected', sidebarEnabled: false }));
    fs.writeFileSync(fixtureNode, '// updated desktop');
    await module.exports.install(false);
    assert.ok(running.has('com.tiboreset.monitor'), 'Upgrade must wait for the previous service to exit');
    assert.equal(fs.readFileSync(path.join(data, 'runtime/node'), 'utf8'), '// fixture runtime', 'Desktop updates cannot replace the pinned runtime');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'))).model, 'user-selected');
  }
  assert.ok(fs.existsSync(path.join(old, 'badge-settings.json'))); assert.ok(fs.existsSync(path.join(old, 'x-announcements-cache.json')));
}
(async () => { try { await scenario(false); await scenario(true); console.log('PASS isolated install migration, private file permissions, legacy disable, original preservation and failure rollback'); } finally { fs.rmSync(temp, { recursive: true, force: true }); } })().catch(e => { console.error(e); process.exitCode = 1; });
