'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-startup-test-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
let watcher, duplicate;
(async () => {
  await run('xcrun', ['swiftc', path.join(root, 'native/StartupPolicy.swift'), path.join(__dirname, 'StartupPolicyTests.swift'), '-o', path.join(temp, 'policy')]);
  console.log((await run(path.join(temp, 'policy'))).stdout.trim());
  const binary = path.join(root, '.build/TiboReset/native/startup'), receipt = path.join(temp, 'state.json');
  // A nonexistent bundle allows exercising the real native event loop without touching the user's application.
  watcher = spawn(binary, [path.join(temp, 'Not Installed.app'), '39449', receipt], { stdio: 'ignore' });
  for (let i = 0; i < 30 && !fs.existsSync(receipt); i++) await wait(100);
  assert.equal(JSON.parse(fs.readFileSync(receipt)).event, 'watching');
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  duplicate = spawn(binary, [path.join(temp, 'Not Installed.app'), '39449', receipt], { stdio: 'ignore' });
  assert.equal(await new Promise(r => duplicate.once('exit', r)), 1, 'Only one watcher may own a receipt');
  watcher.kill('SIGTERM'); await new Promise(r => watcher.once('exit', r)); watcher = null;
  fs.writeFileSync(receipt, '{broken');
  await assert.rejects(run(binary, [path.join(temp, 'Not Installed.app'), '39449', receipt]), e => e.code === 1);
  console.log('PASS native startup lifecycle, private receipts, duplicate exclusion and invalid-state refusal');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  watcher?.kill('SIGTERM'); duplicate?.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true });
});
