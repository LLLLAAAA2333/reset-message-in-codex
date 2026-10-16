const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn, execFileSync } = require('node:child_process'), { PassThrough } = require('node:stream');
const { MenuBarTransport } = require('./bundle.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-menu-test-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, native, duplicate;
(async () => {
  const input = new PassThrough(), output = new PassThrough(), actions = [];
  let closed = false, result = '';
  output.on('data', data => result += data);
  const transport = new MenuBarTransport({ input, output, onAction: action => actions.push(action), onClose: () => closed = true });
  input.write('bad json\n{"action":"shell","command":"bad"}\n{"action":"refresh"}\n{"action":"wake"}\n');
  input.write(JSON.stringify({ action: 'connect', extra: 'x'.repeat(1100) }) + '\n');
  assert.deepEqual(actions, ['refresh', 'wake']);
  transport.update({ records: [], unreadIds: ['101'] });
  assert.deepEqual(JSON.parse(result), { type: 'snapshot', records: [], unreadIds: ['101'] });
  input.end(); await wait(10); assert.ok(closed);

  // Exercise the real background entrypoint with the desktop absent and the X
  // collector explicitly disabled. This must never open a real X session.
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ appPath: '/not-installed/Client.app', sidebarEnabled: true }));
  fs.writeFileSync(path.join(temp, 'x-announcements-cache.json'), JSON.stringify({ version: 1, enabled: false, posts: [], records: [], unread: [] }));
  child = spawn(process.execPath, [path.join(__dirname, '../.build/TiboReset/app.cjs'), '--stdio', '--standalone'], {
    env: { ...process.env, TIBO_RESET_DATA_DIR: temp, PATH: '' }, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '', stderr = ''; child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes);
  for (let i = 0; i < 50 && !fs.existsSync(path.join(temp, 'status.json')); i++) await wait(50);
  assert.equal(stderr, '');
  const health = JSON.parse(fs.readFileSync(path.join(temp, 'status.json')));
  assert.equal(health.mode, 'menu-bar'); assert.equal(health.connectedWindows, 0); assert.equal(health.startup.mode, 'menu-bar');
  assert.equal(JSON.parse(stdout.split('\n')[0]).xState, 'disconnected');
  const exit = new Promise(resolve => child.once('exit', resolve)); child.stdin.end();
  assert.equal(await Promise.race([exit, wait(3000).then(() => 'timeout')]), 0, 'Closing the app pipe stops the backend'); child = null;
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ appPath: '/not-installed/Client.app', sidebarEnabled: false }));

  execFileSync('xcrun', ['swiftc', path.join(__dirname, '../native/MenuBarModel.swift'), path.join(__dirname, 'MenuBarModelTests.swift'), '-o', path.join(temp, 'model')]);
  process.stdout.write(execFileSync(path.join(temp, 'model')));
  fs.mkdirSync(path.join(temp, 'runtime')); fs.symlinkSync(process.execPath, path.join(temp, 'runtime/node'));
  const executable = path.join(__dirname, '../.build/TiboReset/Tibo Reset.app/Contents/MacOS/TiboReset');
  const env = { ...process.env, TIBO_RESET_DATA_DIR: temp };
  fs.rmSync(path.join(temp, 'status.json'));
  native = spawn(executable, [], { env, stdio: 'ignore' });
  for (let i = 0; i < 100 && !fs.existsSync(path.join(temp, 'status.json')); i++) await wait(50);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'status.json'))).xState, 'disconnected');
  assert.equal(Number(fs.readFileSync(path.join(temp, 'menubar.pid'))), native.pid);
  duplicate = spawn(executable, [], { env, stdio: 'ignore' });
  assert.equal(await new Promise(resolve => duplicate.once('exit', resolve)), 0); duplicate = null;
  assert.equal(Number(fs.readFileSync(path.join(temp, 'menubar.pid'))), native.pid, 'Duplicate must not remove the running app receipt');
  const nativeExit = new Promise(resolve => native.once('exit', resolve));
  fs.writeFileSync(path.join(temp, 'stop.request'), '');
  assert.equal(await Promise.race([nativeExit, wait(8000).then(() => 'timeout')]), 0, 'Stop request gracefully closes the native app and background process'); native = null;
  assert.ok(!fs.existsSync(path.join(temp, 'menubar.pid')));
  console.log('PASS real native app: isolated background lifecycle, single instance, receipt ownership and graceful shutdown');
  for (const theme of ['light', 'dark']) {
    const file = path.join(temp, theme + '.png');
    execFileSync(executable, ['--preview', theme, file], { stdio: 'ignore', timeout: 10000 });
    const png = fs.readFileSync(file);
    assert.ok(png.readUInt32BE(16) >= 380 && png.readUInt32BE(20) >= 500, 'Native preview must render a full-size panel, not a 1×1 placeholder');
    assert.ok(png.length > 5000);
  }
  console.log('PASS native light/dark preview rendering');
  const layout = path.join(temp, 'layout.json');
  execFileSync(executable, ['--layout-test', layout], { timeout: 15000 });
  const cases = JSON.parse(fs.readFileSync(layout));
  assert.equal(cases.length, 4);
  for (const item of cases) {
    assert.ok(item.headerVisible && item.connectionVisible && item.footerVisible && item.insideScreen, item.case);
    assert.ok(item.height <= 554 && item.windowHeight <= 594, item.case);
    if (item.case.startsWith('short-screen')) assert.ok(item.height <= 340, item.case);
  }
  console.log('PASS actual status-item popover: 11 long announcements, live error update, short screen and pinned header/footer');
  console.log('PASS menu pipes: command allowlist, snapshot delivery, EOF shutdown, no desktop or debug-port dependency');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { child?.kill('SIGTERM'); native?.kill('SIGTERM'); duplicate?.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); });
