const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { readSettings, validateResetResult, createCodexResetParser } = require('../.build/TiboReset/app.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tibo-core-test-'));
(async () => {
  const file = path.join(tmp, 'settings.json');
  assert.equal(readSettings(file).xPollSeconds, 60);
  for (const invalid of [[], { port: 80 }, { xPollSeconds: 1 }, { displayTimezone: 'bad-zone' }, { proxyUrl: 'file:///tmp/' }, { proxyUrl: 'http://user:pass@localhost' }]) {
    fs.writeFileSync(file, JSON.stringify(invalid)); assert.throws(() => readSettings(file));
  }
  const parent = { id: '123', author: 'thsottiaux', url: 'https://x.com/thsottiaux/status/123', text: 'Paid Codex accounts will get a reset.', publishedAt: '2026-10-12T16:00:00Z' };
  const post = { id: '124', url: 'https://x.com/thsottiaux/status/124', text: 'Will be there by EOD PST.', parentId: '123', conversationId: '123', publishedAt: '2026-10-14T01:00:00Z', threadContext: [parent] };
  const result = { id: '124', isReset: true, status: 'scheduled', precision: 'unknown', resetAt: null, resetDate: null, timezone: null,
    timeKind: 'deadline', timePhrase: 'by EOD PST', timeNote: null, evidence: post.text, summary: '预计当天结束前完成', scope: '付费 Codex 账户' };
  const record = validateResetResult(result, post);
  assert.equal(record.timeKind, 'deadline'); assert.equal(record.resetAt, null); assert.equal(record.resetDate, '2026-10-13'); assert.equal(record.threadContext.length, 1);
  assert.equal(validateResetResult({ ...result, status: 'completed' }, post).status, 'completed');
  assert.equal(validateResetResult({ ...result, isReset: false }, post), null);
  assert.throws(() => validateResetResult({ ...result, evidence: 'invented' }, post));
  const fakeSpawn = (_command, args, options) => {
    assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('features.shell_tool=false'));
    const output = args[args.indexOf('--output-last-message') + 1];
    return require('node:child_process').spawn(process.execPath, ['-e', `let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const posts=JSON.parse(input.split('POSTS_JSON:')[1]);if(posts[0].summary||posts[0].threadContext.length!==1)process.exit(2);require('node:fs').writeFileSync(${JSON.stringify(output)},${JSON.stringify(JSON.stringify({results:[result]}))});});`], options);
  };
  assert.deepEqual(await createCodexResetParser({ spawn: fakeSpawn })([{ ...post, summary: 'do not send old interpretation' }]), [result]);
  console.log('PASS settings validation, contextual evidence, deadline date anchor, status preservation and CLI isolation');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
