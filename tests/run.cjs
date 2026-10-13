const { spawnSync } = require('node:child_process');
const path = require('node:path');
const tests = ['core', 'x-monitor', 'sidebar', 'connection'];
tests.push(...(process.platform === 'win32' ? ['windows-install'] : ['startup', 'install']), 'windows');
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test + '.cjs')], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
