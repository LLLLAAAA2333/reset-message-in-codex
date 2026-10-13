'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { findEdge } = require('./platform.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
class CDP {
  constructor(url, port) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || Number(parsed.port) !== port || parsed.username || parsed.password) throw Error('Invalid local debugger endpoint');
    this.url = url; this.pending = new Map(); this.nextId = 1; this.events = () => {}; this.closed = false;
  }
  async open() {
    const socket = this.socket = new WebSocket(this.url);
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || event.data.length > 10 * 1024 * 1024) { socket.close(); return; }
      let message; try { message = JSON.parse(event.data); } catch { return; }
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id); clearTimeout(entry.timer);
        message.error ? entry.reject(Error('Browser operation failed')) : entry.resolve(message.result);
      } else { try { this.events(message.method, message.params || {}); } catch {} }
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Browser disconnected')); }
      this.pending.clear(); this.onClose?.();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('Browser connection timed out')); }, 8000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Browser connection failed')); }, { once: true });
    });
  }
  call(method, params = {}) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('Browser is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Browser operation timed out')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}
function publicMessage(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'failure') return { type: 'failure', status: [401,403,429].includes(value.status) ? value.status : 0 };
  const kinds = ['UserTweets','UserOriginalsTimeline','UserTweetsAndReplies','UserRepliesTimeline','TweetDetail'];
  if (value.type === 'diagnostic' && kinds.includes(value.operation)) return { type: 'diagnostic', operation: value.operation, status: Number.isInteger(value.status) ? value.status : 0 };
  if (value.type !== 'posts' || !kinds.includes(value.endpoint) || !Array.isArray(value.posts)) return null;
  const posts = value.posts.slice(0,200).filter(p => p && p.author === 'thsottiaux' && /^\d{1,25}$/.test(p.id || '') && p.url === `https://x.com/thsottiaux/status/${p.id}` && typeof p.text === 'string' && p.text.trim() && Number.isFinite(Date.parse(p.publishedAt)))
    .map(p => ({ id: p.id, author: 'thsottiaux', url: p.url, text: p.text.slice(0,12000), publishedAt: new Date(p.publishedAt).toISOString(),
      parentId: /^\d{1,25}$/.test(p.parentId || '') ? p.parentId : null, conversationId: /^\d{1,25}$/.test(p.conversationId || '') ? p.conversationId : p.id }));
  return posts.length ? { type: 'posts', endpoint: value.endpoint, posts } : { type: 'failure', status: 0 };
}
class WindowsXSource {
  constructor({ data, script, browser, proxy = '', emit = () => {} }) {
    this.data = data; this.profile = path.join(data, 'XSession'); this.marker = path.join(data, 'x-session-ready');
    this.script = script; this.executable = browser; this.proxy = proxy; this.emit = emit;
    this.contexts = new Map(); this.cycle = 0; this.stopped = false; this.selfClosing = false; this.queue = Promise.resolve();
  }
  enqueue(work) {
    this.queue = this.queue.then(work).catch(() => { if (!this.stopped) this.emit({ type: 'failure', status: 0 }); });
    return this.queue;
  }
  async initialize() {
    this.emit({ type: 'started' });
    if (fs.existsSync(this.marker)) { await this.launch(false); await this.refresh(); }
    else this.emit({ type: 'state', state: 'login-required' });
  }
  async launch(visible) {
    if (this.browser) await this.closeBrowser();
    fs.mkdirSync(this.profile, { recursive: true, mode: 0o700 });
    const active = path.join(this.profile, 'DevToolsActivePort'); fs.rmSync(active, { force: true });
    const args = [`--user-data-dir=${this.profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      ...(visible ? ['--app=about:blank', '--window-size=960,760'] : ['--headless=new']), ...(this.proxy ? [`--proxy-server=${this.proxy}`] : []), ...(visible ? [] : ['about:blank'])];
    this.child = spawn(this.executable, args, { stdio: 'ignore', windowsHide: !visible });
    let spawnError; this.child.once('error', error => { spawnError = error; });
    let lines;
    for (let i=0;i<100;i++) {
      if (spawnError) throw Error('Edge could not start');
      if (fs.existsSync(active)) { lines = fs.readFileSync(active,'utf8').trim().split(/\r?\n/); break; }
      await wait(100);
    }
    const port = Number(lines?.[0]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(lines?.[1] || '')) throw Error('Dedicated Edge debugger did not start; close only the Tibo X window and retry');
    this.visible = visible;
    const browser = this.browser = new CDP(`ws://127.0.0.1:${port}${lines[1]}`, port); await browser.open();
    let target;
    for(let i=0;i<30;i++) {
      const targets = (await browser.call('Target.getTargets')).targetInfos;
      target = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || !t.url));
      if(target)break;await wait(100);
    }
    if(!target)target=await browser.call('Target.createTarget',{url:'about:blank'});
    if (!target || !/^[\w-]+$/.test(target.targetId)) throw Error('Dedicated browser target is missing');
    const page = this.page = new CDP(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`,port);
    await page.open(); this.contexts.clear();
    page.events = (method, params) => {
      if (method === 'Runtime.executionContextCreated') this.contexts.set(params.context.id, params.context);
      if (method === 'Runtime.executionContextDestroyed') this.contexts.delete(params.executionContextId);
      if (method === 'Runtime.executionContextsCleared') this.contexts.clear();
      if (method === 'Page.frameNavigated' && !params.frame.parentId) this.mainFrame = params.frame.id;
      if (method === 'Runtime.bindingCalled' && params.name === '__tiboXNative') {
        const context = this.contexts.get(params.executionContextId);
        if (!context?.auxData?.isDefault || context.origin !== 'https://x.com' || context.auxData.frameId !== this.mainFrame || typeof params.payload !== 'string' || params.payload.length > 3 * 1024 * 1024) return;
        try { const safe = publicMessage(JSON.parse(params.payload)); if (safe) this.receive(safe); } catch {}
      }
    };
    page.onClose = () => {
      if (!this.selfClosing && !this.stopped && this.page === page) this.enqueue(async () => {
        this.browser?.close(); this.page = null; this.browser = null; clearTimeout(this.repliesTimer); clearInterval(this.sessionTimer);
        if (fs.existsSync(this.marker)) { await this.launch(false); await this.refresh(); }
        else this.emit({ type: 'state', state: 'login-required' });
      });
    };
    await page.call('Page.enable'); await page.call('Runtime.enable'); await page.call('Runtime.addBinding',{ name: '__tiboXNative' });
    this.mainFrame = (await page.call('Page.getFrameTree')).frameTree.frame.id;
    const source = `Object.defineProperty(globalThis, '__tiboXSend', { value: value => globalThis.__tiboXNative(JSON.stringify(value)) });\n` + fs.readFileSync(this.script,'utf8');
    await page.call('Page.addScriptToEvaluateOnNewDocument',{ source });
    this.sessionTimer = setInterval(() => this.enqueue(() => this.checkSession()),3000);
  }
  async navigate(url) { this.loadingAt = Date.now(); await this.page.call('Page.navigate',{ url }); }
  async refresh() {
    if (!this.page || this.stopped) { this.emit({ type: 'state', state: 'login-required' }); return; }
    if (this.visible && !fs.existsSync(this.marker)) return;
    this.cycle++; clearTimeout(this.repliesTimer); this.phase = 'posts'; this.scrolls = 0;
    this.emit({ type: 'cycle' }); this.emit({ type: 'state', state: 'loading' }); await this.navigate('https://x.com/thsottiaux');
  }
  receive(message) {
    if (this.stopped) return;
    this.emit(message);
    if (message.type === 'posts') {
      fs.writeFileSync(this.marker,'1',{mode:0o600}); this.loadingAt = 0; this.lastBatch = Date.now();
      if (this.phase === 'posts' && ['UserTweets','UserOriginalsTimeline'].includes(message.endpoint)) {
        this.phase = 'waiting-replies'; const cycle = this.cycle;
        this.repliesTimer = setTimeout(() => this.enqueue(async () => {
          if (this.stopped || !this.page || this.cycle !== cycle) return;
          this.phase = 'replies'; this.scrolls = 0; await this.navigate('https://x.com/thsottiaux/with_replies');
        }),6000);
      }
    } else if (message.type === 'failure') {
      this.loadingAt = 0;
      if (message.status === 401) fs.rmSync(this.marker,{force:true});
    }
  }
  async checkSession() {
    if (!this.page || this.stopped) return;
    // Page location and scroll state only. No cookie APIs or request headers.
    const result = await this.page.call('Runtime.evaluate',{ expression: 'location.origin === "https://x.com" ? location.pathname : ""', returnByValue:true });
    const location = result.result?.value || '';
    if (location === '/home' && this.visible && !fs.existsSync(this.marker)) {
      this.phase = 'posts'; this.cycle++; this.emit({type:'cycle'}); await this.navigate('https://x.com/thsottiaux');
    } else if (location.startsWith('/i/flow/') && !this.visible) {
      fs.rmSync(this.marker,{force:true}); await this.closeBrowser(); this.emit({type:'state',state:'login-required'});
    } else if (this.loadingAt && Date.now()-this.loadingAt>45000) { this.loadingAt=0; this.emit({type:'failure',status:0}); }
    else if (!this.loadingAt && this.scrolls<4 && Date.now()-(this.lastBatch || 0)<25000) {
      this.scrolls++; await this.page?.call('Runtime.evaluate',{expression:'window.scrollBy(0, window.innerHeight * 2)'});
    }
  }
  async closeBrowser() {
    clearInterval(this.sessionTimer); clearTimeout(this.repliesTimer);
    const browser=this.browser, page=this.page;
    if (!browser) return;
    this.selfClosing=true;
    try {
      try { await browser.call('Browser.close'); } catch (error) { if (!browser.closed) throw error; }
      for (let i=0;i<50 && !browser.closed;i++) await wait(100);
      if (!browser.closed) throw Error('Dedicated browser did not close gracefully');
      for(let i=0;i<50 && this.child?.exitCode===null;i++)await wait(100);
      if(this.child?.exitCode===null)throw Error('Dedicated browser process is still exiting');
      page?.close(); browser.close(); this.page=null; this.browser=null;
    } finally { this.selfClosing=false; }
  }
  async command(message) {
    if (message.action === 'stop') { this.stopped=true; await this.closeBrowser(); return; }
    if (message.action === 'disconnect') {
      this.cycle++; this.stopped=true;
      try { await this.closeBrowser(); fs.rmSync(this.profile,{recursive:true,force:true,maxRetries:10,retryDelay:200}); fs.rmSync(this.marker,{force:true}); this.emit({type:'state',state:'disconnected'}); }
      catch { this.emit({type:'disconnect-failed'}); }
    } else if (message.action === 'connect') {
      this.stopped=false; await this.launch(true);
      if (fs.existsSync(this.marker)) await this.refresh();
      else { this.emit({type:'state',state:'login-required'}); await this.navigate('https://x.com/i/flow/login'); }
    } else if (message.action === 'refresh' && !this.stopped) await this.refresh();
    else if (message.action === 'thread' && !this.stopped && this.page && fs.existsSync(this.marker) && /^\d{1,25}$/.test(message.id || '')) {
      this.cycle++; clearTimeout(this.repliesTimer); this.phase='thread'; this.scrolls=4; await this.navigate('https://x.com/thsottiaux/status/'+message.id);
    }
  }
}
module.exports = { CDP, publicMessage, WindowsXSource };
if (require.main === module) {
  const data=process.env.TIBO_RESET_DATA_DIR;
  if (!data) process.exit(2);
  const lockFile=path.join(data,'x-bridge.lock'); let lock;
  try {
    if (fs.existsSync(lockFile)) {
      const pid=Number(fs.readFileSync(lockFile,'utf8'));
      if (!Number.isInteger(pid) || pid<=0) throw Error('Invalid bridge lock');
      try { process.kill(pid,0); process.exit(1); } catch (error) { if (error.code!=='ESRCH') throw error; }
      fs.rmSync(lockFile);
    }
    lock=fs.openSync(lockFile,'wx',0o600); fs.writeFileSync(lock,String(process.pid));
    process.stdout.on('error',()=>{});
    const source=new WindowsXSource({data,script:process.argv[2],browser:findEdge(process.argv[4]),proxy:process.argv[3] || '',emit:message=>{if(process.stdout.writable)process.stdout.write(JSON.stringify(message)+'\n');}});
    let exiting=false;
    const finishExit=async()=>{
      try { await source.queue;await source.command({action:'stop'});fs.closeSync(lock);fs.rmSync(lockFile,{force:true});process.exit(0); }
      catch { setTimeout(finishExit,2000); }
    };
    const exit=()=>{if(exiting)return;exiting=true;source.stopped=true;clearInterval(source.sessionTimer);clearTimeout(source.repliesTimer);finishExit();};
    process.stdin.setEncoding('utf8'); let input='';
    process.stdin.on('data',chunk=>{
      input+=chunk; if(input.length>8192) { exit(); return; }
      let end; while((end=input.indexOf('\n'))>=0) { const line=input.slice(0,end); input=input.slice(end+1);
        try { const message=JSON.parse(line); if(message.action==='stop') exit(); else source.enqueue(()=>exiting?undefined:source.command(message)); } catch {}
      }
    });
    process.stdin.on('end',exit); process.on('SIGTERM',exit); process.on('SIGINT',exit);
    source.enqueue(()=>exiting?undefined:source.initialize());
  } catch { if(lock!==undefined){fs.closeSync(lock);fs.rmSync(lockFile,{force:true});} process.stdout.write('{"type":"failure","status":0}\n'); process.exit(1); }
}
