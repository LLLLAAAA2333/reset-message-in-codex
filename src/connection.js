// Minimal CDP transport for our sidebar only. No conversation or quota reads.
function isCodexPage(target) {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' &&
      !/overlay/i.test(decodeURIComponent(url.search + url.hash));
  } catch { return false; }
}
async function desktopPages(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) throw Error('桌面调试接口不可用');
  const body = await response.text();
  if (body.length > 1024 * 1024) throw Error('调试目标列表过大');
  const targets = JSON.parse(body);
  if (!Array.isArray(targets)) throw Error('调试目标列表无效');
  return targets.filter(isCodexPage).slice(0, 20);
}
class PageChannel {
  constructor(target, port) {
    const url = new URL(target.webSocketDebuggerUrl);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== port || url.username || url.password) throw Error('仅允许连接指定的本机调试端口');
    this.url = url.href; this.waiting = new Map(); this.nextId = 1;
  }
  async open() {
    const socket = this.socket = new WebSocket(this.url);
    socket.addEventListener('message', event => {
      let reply; try { reply = JSON.parse(event.data); } catch { return; }
      const pending = this.waiting.get(reply.id); if (!pending) return;
      this.waiting.delete(reply.id); clearTimeout(pending.timer);
      if (reply.error || reply.result?.exceptionDetails) pending.reject(Error('侧边栏脚本执行失败'));
      else pending.resolve(reply.result?.result?.value);
    });
    socket.addEventListener('close', () => this.fail());
    socket.addEventListener('error', () => this.fail());
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { socket.close(); finish(Error('连接桌面超时')); }, 3000);
      socket.addEventListener('open', () => finish(), { once: true });
      socket.addEventListener('error', () => finish(Error('桌面连接失败')), { once: true });
      socket.addEventListener('close', () => finish(Error('桌面连接已关闭')), { once: true });
    });
  }
  evaluate(expression) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('桌面未连接'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.waiting.delete(id); reject(Error('侧边栏响应超时')); }, 4000);
      this.waiting.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); }
      catch (error) { clearTimeout(timer); this.waiting.delete(id); reject(error); }
    });
  }
  fail() { for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(Error('桌面连接中断')); } this.waiting.clear(); }
  close() { this.fail(); this.socket?.close(); }
}
class SidebarHost {
  constructor(port) { this.port = port; this.channels = new Map(); this.snapshot = null; this.stopped = false; }
  async scan() {
    let pages;
    try { pages = await desktopPages(this.port); }
    catch { for (const c of this.channels.values()) c.close(); this.channels.clear(); return; }
    const ids = new Set(pages.map(p => p.id));
    for (const [id, channel] of this.channels) if (!ids.has(id)) { channel.close(); this.channels.delete(id); }
    await Promise.all(pages.map(async page => {
      let channel = this.channels.get(page.id);
      try {
        if (!channel) { channel = new PageChannel(page, this.port); await channel.open(); }
        if (this.stopped) { channel.close(); return; }
        await channel.evaluate(`(${installTiboSidebar.toString()})()`);
        if (this.snapshot) await channel.evaluate(`window.__tiboReset?.update(${JSON.stringify(this.snapshot)})`);
        if (this.stopped) channel.close(); else this.channels.set(page.id, channel);
      } catch { channel?.close(); this.channels.delete(page.id); }
    }));
  }
  async update(value) {
    this.snapshot = value;
    await Promise.all([...this.channels].map(async ([id, channel]) => {
      try { await channel.evaluate(`window.__tiboReset?.update(${JSON.stringify(value)})`); }
      catch { channel.close(); this.channels.delete(id); }
    }));
  }
  async actions() {
    const commands = new Set();
    for (const channel of this.channels.values()) {
      try { for (const action of await channel.evaluate('window.__tiboReset?.takeActions() || []') || []) if (['read', 'connect', 'disconnect', 'refresh'].includes(action)) commands.add(action); }
      catch {}
    }
    return [...commands];
  }
  async close() {
    this.stopped = true;
    await Promise.all([...this.channels.values()].map(async channel => {
      try { await channel.evaluate('window.__tiboReset?.destroy()'); } catch {} finally { channel.close(); }
    }));
    this.channels.clear();
  }
}
