const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const test of ['core', 'x-monitor', 'sidebar', 'connection', 'startup', 'install']) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test + '.cjs')], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
