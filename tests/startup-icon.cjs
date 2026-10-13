'use strict';
// Exercises macOS original-app launching with a disposable app, never the real Codex process.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { spawn, execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile), wait = ms => new Promise(r => setTimeout(r, ms));
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-icon-test-'));
const app = path.join(temp, 'Tibo Startup Test.app'), macos = path.join(app, 'Contents/MacOS');
const eventsFile = path.join(app, 'Contents/launches.jsonl'), receipt = path.join(temp, 'state.json');
let watcher;
const events = () => { try { return fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const state = () => { try { return JSON.parse(fs.readFileSync(receipt)); } catch { return {}; } };
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (check()) return; await wait(100); }
  throw Error(message + ': ' + JSON.stringify({ state: state(), launches: events().map(e => e.args) }));
}
async function stopWatcher() { if (watcher) { const child = watcher; watcher = null; child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); } }
function cleanupFixture() { for (const e of events()) { try { process.kill(e.pid, 'SIGTERM'); } catch {} } }
async function startWatcher() {
  fs.rmSync(receipt, { force: true });
  watcher = spawn(path.join(root, '.build/TiboReset/native/startup'), [app, '39449', receipt], { stdio: 'inherit' });
  await until(() => state().event === 'watching', 'Watcher did not start');
}
(async () => {
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>local.tiboreset.test.${process.pid}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleName</key><string>Tibo Startup Test</string></dict></plist>`);
  fs.writeFileSync(path.join(temp, 'fixture.m'), `#import <AppKit/AppKit.h>
@interface FixtureDelegate : NSObject <NSApplicationDelegate>
@end
@implementation FixtureDelegate
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  NSString *flag = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/refuse"];
  return [NSFileManager.defaultManager fileExistsAtPath:flag] ? NSTerminateCancel : NSTerminateNow;
}
@end
int main(void) { @autoreleasepool {
  NSString *file = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/launches.jsonl"];
  NSDictionary *event = @{@"pid": @(NSProcessInfo.processInfo.processIdentifier), @"args": NSProcessInfo.processInfo.arguments};
  NSMutableData *line = [[NSJSONSerialization dataWithJSONObject:event options:0 error:nil] mutableCopy]; [line appendData:[@"\\n" dataUsingEncoding:NSUTF8StringEncoding]];
  if (![NSFileManager.defaultManager fileExistsAtPath:file]) [NSFileManager.defaultManager createFileAtPath:file contents:nil attributes:nil];
  NSFileHandle *out = [NSFileHandle fileHandleForWritingAtPath:file]; [out seekToEndOfFile]; [out writeData:line]; [out closeFile];
  NSApplication *a = NSApplication.sharedApplication; [a setActivationPolicy:NSApplicationActivationPolicyRegular];
  FixtureDelegate *delegate = [FixtureDelegate new]; a.delegate = delegate;
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200,200,320,100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO]; window.title = @"Tibo 自动启动测试";
  [window makeKeyAndOrderFront:nil];
  [NSTimer scheduledTimerWithTimeInterval:30 repeats:NO block:^(NSTimer *t){ exit(0); }];
  [a run];
} return 0; }
`);
  await run('xcrun', ['clang', '-fobjc-arc', '-framework', 'AppKit', path.join(temp, 'fixture.m'), '-o', path.join(macos, 'fixture')]);
  await startWatcher();
  await run('/usr/bin/open', ['-a', app]);
  await until(() => state().event === 'connected', 'Fresh original-app launch did not reconnect');
  assert.equal(events().length, 2);
  assert.ok(events()[1].args.includes('--remote-debugging-port=39449'));
  assert.ok(events()[1].args.includes('--remote-debugging-address=127.0.0.1'));
  await wait(1000); assert.equal(events().length, 2, 'Must not repeatedly relaunch');
  await stopWatcher(); cleanupFixture(); await wait(300);
  fs.rmSync(eventsFile);
  // Installing/restarting the monitor while an app is already open must never close it.
  await run('/usr/bin/open', ['-a', app]); await until(() => events().length === 1, 'Fixture missing');
  await startWatcher(); await wait(1000); assert.equal(events().length, 1); assert.equal(state().event, 'watching');
  await stopWatcher(); cleanupFixture(); await wait(300); fs.rmSync(eventsFile);
  // The app may decline a graceful quit. There must be no escalation to a forced exit.
  fs.writeFileSync(path.join(app, 'Contents/refuse'), '');
  await startWatcher(); await run('/usr/bin/open', ['-a', app]);
  await until(() => ['quit-refused', 'quit-timeout'].includes(state().event), 'Quit refusal not respected');
  assert.equal(events().length, 1); process.kill(events()[0].pid, 0);
  console.log('PASS real macOS original-icon launch, graceful reconnect, loopback arguments, no relaunch loop, existing-window preservation and refused quit');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await stopWatcher(); cleanupFixture(); await wait(300); fs.rmSync(temp, { recursive: true, force: true });
});
