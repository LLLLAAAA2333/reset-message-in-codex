const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['core', 'x-monitor', 'sidebar', 'connection'];
tests.push(...(process.platform === 'win32' ? ['windows-install', 'windows'] : ['startup', 'install']));
if (process.platform !== 'win32' && process.env.TIBO_TEST_WINDOWS === '1') tests.push('windows');
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test + '.cjs')], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
