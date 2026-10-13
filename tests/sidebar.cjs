const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { installTiboSidebar } = require('./bundle.cjs');
const fixture = '<html class="light"><style>body{font:14px sans-serif;margin:0}nav{width:52px;height:100vh;display:flex;flex-direction:column;align-items:center;background:#eee}.spacer{flex:1}.footer{height:52px}input{position:absolute;left:100px;top:40px}</style><nav data-app-navigation-rail><div class="spacer"></div><div class="footer">☰</div></nav><input id="editor" value="正在编辑"/></html>';
const record = { id: '2109812360596865224', url: 'https://x.com/thsottiaux/status/2109812360596865224',
  publishedAt: '2026-10-13T01:03:59Z', text: 'Global reset landing by EOD PST time. Enjoy', threadContext: [{ text: 'Day 8/ Reset' }],
  status: 'scheduled', timeKind: 'deadline', timePhrase: 'by EOD PST time', precision: 'day', resetDate: '2026-10-12', timezone: 'PST',
  summary: '重复摘要', scope: '范围说明', timeNote: '时间说明', parserState: 'done' };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 650, height: 700 } });
    await page.setContent(fixture); await page.locator('#editor').focus();
    const script = `(${installTiboSidebar.toString()})()`;
    await page.evaluate(script); await page.evaluate(script);
    assert.equal(await page.locator('#tibo-reset-announcements').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor');
    const snapshot = { records: [record], state: 'ready', source: 'x', xEnabled: true, xState: 'ready', unreadIds: ['2109812360596865224'], displayTimezone: 'Asia/Shanghai' };
    await page.evaluate(s => window.__tiboReset.update(s), snapshot);
    await page.locator('#tibo-reset-announcements').click();
    assert.deepEqual(await page.evaluate(() => window.__tiboReset.takeActions()), ['read']);
    const article = page.locator('#tibo-reset-panel article');
    assert.match(await article.textContent(), /2026-10-13 16:00前完成（北京时间，按日末估算）.*原文：Global reset.*前文：Day 8\/ Reset/);
    assert.match(await article.locator('strong').getAttribute('title'), /提前一小时/);
    assert.match(await article.textContent(), /发布于 2026-10-13 09:03（北京时间）/);
    assert.doesNotMatch(await article.textContent(), /重复摘要|范围说明|时间说明/);
    assert.equal(await article.locator('a').getAttribute('href'), record.url);
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(v => document.documentElement.className = v, theme);
      await page.locator('#tibo-reset-panel').screenshot({ path: path.join(__dirname, 'artifacts/sidebar-' + theme + '.png') });
    }
    for (const [patch, expected] of [
      [{ timezone: 'PDT' }, '2026-10-13 15:00前完成'],
      [{ timezone: 'PT' }, '2026-10-13 15:00前完成'],
      [{ timezone: 'PT', resetDate: '2026-11-01' }, '2026-11-02 16:00前完成'],
      [{ timezone: 'PT', resetDate: '2026-03-08' }, '2026-03-09 15:00前完成'],
      [{ timezone: 'PST', resetDate: '2026-12-31' }, '2027-01-01 16:00前完成'],
      [{ timezone: 'UTC+05:30' }, '2026-10-13 02:30前完成'],
      [{ timezone: null }, '无法换算北京时间'],
      [{ timezone: 'invalid' }, '无法换算北京时间'],
      [{ resetDate: '2026-02-30' }, '无法换算北京时间'],
      [{ timeKind: 'instant', precision: 'exact', resetAt: '2026-10-13T07:00:00Z' }, '2026-10-13 15:00（北京时间）'],
      [{ timeKind: 'instant', precision: 'day', timezone: 'PT', resetDate: '2026-11-01' }, '2026-11-01 15:00 至 2026-11-02 16:00'],
      [{ status: 'completed' }, '作者宣布重置已完成']
    ]) {
      await page.evaluate(({ snapshot, patch }) => window.__tiboReset.update({ ...snapshot, records: [{ ...snapshot.records[0], ...patch }] }), { snapshot, patch });
      assert.ok((await article.locator('strong').textContent()).includes(expected), JSON.stringify(patch));
    }
    await page.evaluate(s => window.__tiboReset.update(s), snapshot);
    await page.getByRole('button', { name: '立即检查' }).click();
    assert.deepEqual(await page.evaluate(() => window.__tiboReset.takeActions()), ['refresh']);
    await page.evaluate(s => window.__tiboReset.update({ ...s, records: [{ ...s.records[0], text: '<img src=x onerror="window.attacked=1">', threadContext: [{ text: '<svg onload="window.attacked=1">' }] }] }), snapshot);
    assert.equal(await article.locator('img, svg').count(), 0); assert.equal(await page.evaluate(() => window.attacked), undefined);
    await page.evaluate(s => window.__tiboReset.update({ ...s, records: [{ ...s.records[0], url: 'https://example.com/' }] }), snapshot);
    assert.equal(await article.count(), 0);
    await page.evaluate(s => window.__tiboReset.update(s), snapshot);
    await page.setViewportSize({ width: 250, height: 300 });
    await page.evaluate(() => window.__tiboReset.place());
    const box = await page.locator('#tibo-reset-panel').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 250 && box.y + box.height <= 300);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#tibo-reset-panel').isVisible(), false);
    await page.evaluate(() => { const nav = document.querySelector('nav'); const copy = nav.cloneNode(true); copy.querySelector('#tibo-reset-announcements').remove(); nav.replaceWith(copy); });
    await page.waitForSelector('nav #tibo-reset-announcements');
    await page.evaluate(() => window.__tiboReset.destroy());
    assert.equal(await page.locator('[id^="tibo-reset"]').count(), 0);
    console.log('PASS independent sidebar: compact cards, source text, actions, themes, focus, remount, safe text and cleanup');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
