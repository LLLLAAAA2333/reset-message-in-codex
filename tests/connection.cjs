const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PageChannel, SidebarHost, isCodexPage } = require('../.build/TiboReset/app.cjs');
const port = 39448;
for (const url of ['ws://example.com:39448/test', 'ws://127.0.0.1:39222/test', 'wss://127.0.0.1:39448/test', 'ws://user:pass@127.0.0.1:39448/test']) assert.throws(() => new PageChannel({ webSocketDebuggerUrl: url }, port));
assert.equal(isCodexPage({ type: 'page', url: 'app://-/index.html' }), true);
for (const target of [{ type: 'page', url: 'https://example.com/' }, { type: 'page', url: 'app://-/index.html?overlay=1' }, { type: 'worker', url: 'app://-/index.html' }]) assert.equal(isCodexPage(target), false);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: [`--remote-debugging-port=${port}`] });
  const originalFetch = global.fetch, host = new SidebarHost(port);
  try {
    const page = await browser.newPage();
    await page.setContent('<nav data-app-navigation-rail style="height:600px"><div>Footer</div></nav><input id="editor">');
    await page.locator('#editor').focus();
    const targets = await (await originalFetch(`http://127.0.0.1:${port}/json/list`)).json();
    global.fetch = async (url, options) => {
      assert.equal(url, `http://127.0.0.1:${port}/json/list`); assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify(targets.filter(t => t.type === 'page').map(t => ({ ...t, url: 'app://-/index.html' }))));
    };
    host.snapshot = { state: 'ready', records: [], unreadIds: [] };
    await host.scan(); await host.scan();
    assert.equal(host.channels.size, 1); assert.equal(await page.locator('#tibo-reset-announcements').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor');
    await host.update({ state: 'ready', records: [], xEnabled: true, xState: 'ready', unreadIds: [] });
    await page.locator('#tibo-reset-announcements').click();
    assert.deepEqual(await host.actions(), ['read']);
    assert.deepEqual(await host.actions(), []);
    global.fetch = async () => { throw Error('offline'); };
    await host.scan(); assert.equal(host.channels.size, 0);
    global.fetch = async () => new Response(JSON.stringify(targets.filter(t => t.type === 'page').map(t => ({ ...t, url: 'app://-/index.html' }))));
    await host.scan(); assert.equal(host.channels.size, 1); assert.equal(await page.locator('#tibo-reset-announcements').count(), 1);
    await host.close(); assert.equal(await page.locator('#tibo-reset-announcements').count(), 0);
    console.log('PASS real CDP connection, host/port validation, page filtering, reconnect, no duplicates, action queue and cleanup');
  } finally { global.fetch = originalFetch; await host.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
