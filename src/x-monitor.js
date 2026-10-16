// X collection runs in the Tibo Reset process; WebKit owns the isolated login session.
class XAnnouncementMonitor {
  constructor({ onChange = () => {}, parse, xPollSeconds = 60, cacheFile, now = Date.now, spawn = require('node:child_process').spawn, ...options } = {}) {
    this.onChange = onChange; this.parse = parse; this.now = now; this.spawn = spawn;
    this.options = options; this.pollMs = xPollSeconds * 1000;
    this.cacheFile = cacheFile || require('node:path').join(__dirname, 'x-announcements-cache.json');
    this.posts = []; this.records = []; this.unread = []; this.state = 'login-required'; this.checkedAt = null;
    this.nextRead = 0; this.failures = 0; this.stopped = false; this.child = null; this.epoch = 0;
    this.enabled = true; this.parsing = false; this.parseQueue = new Map(); this.controller = new AbortController();
    this.helperLastSeen = null; this.cycleStarted = null; this.cycleToken = null; this.cyclePending = false;
    try {
      const cache = JSON.parse(require('node:fs').readFileSync(this.cacheFile, 'utf8'));
      if (cache.version === 1) {
        this.posts = this.normalize(cache.posts); this.records = (cache.records || []).filter(r => this.posts.some(p => p.id === r.id)).slice(0, 60);
        this.unread = (cache.unread || []).filter(id => this.records.some(r => r.id === id));
        this.enabled = cache.enabled !== false; this.state = this.enabled ? 'login-required' : 'disconnected';
        this.checkedAt = cache.checkedAt || null;
      }
    } catch {}
    this.refreshRecords();
    for (const record of this.records) if (record.parserState === 'pending' || record.parserState === 'failed') this.parseQueue.set(record.id, record);
    this.fallbackSnapshot = { records: [] };
    this.fallback = new ResetAnnouncementMonitor({ ...options, cacheFile: require('node:path').join(require('node:path').dirname(this.cacheFile), 'feed-cache.json'), parse, onChange: value => { this.fallbackSnapshot = value; return this.publish(); } });
    this.fallbackSnapshot = this.fallback.snapshot();
  }
  normalize(posts) {
    if (!Array.isArray(posts)) return [];
    return posts.slice(0, 500).filter(p => p && p.author === 'thsottiaux' && /^\d{1,25}$/.test(p.id) && resetPostUrl(p.url) === `https://x.com/thsottiaux/status/${p.id}` && typeof p.text === 'string' && p.text.trim() && Number.isFinite(Date.parse(p.publishedAt)))
      .map(p => ({ id: p.id, author: 'thsottiaux', url: `https://x.com/thsottiaux/status/${p.id}`, text: p.text.slice(0, 12000), publishedAt: new Date(p.publishedAt).toISOString(),
        parentId: /^\d{1,25}$/.test(p.parentId || '') ? p.parentId : null,
        conversationId: /^\d{1,25}$/.test(p.conversationId || '') ? p.conversationId : p.id,
        firstSeenAt: Number.isFinite(p.firstSeenAt) ? p.firstSeenAt : this.now() }))
      .filter(p => this.now() - Date.parse(p.publishedAt) <= 14 * 86400000 && Date.parse(p.publishedAt) <= this.now() + 300000);
  }
  refreshRecords(before) {
    const roots = new Set(this.posts.filter(isResetCandidate).flatMap(p => [p.id, p.conversationId]));
    const existing = new Map(this.records.map(p => [p.id, p])), records = [], notices = [];
    for (const p of this.posts) {
      if (!isResetCandidate(p) && !roots.has(p.conversationId) && !roots.has(p.parentId)) continue;
      const threadContext = resetThreadContext({ ...p, threadContext: this.posts });
      const input = { ...p, threadContext }, analysisKey = resetAnalysisKey(input);
      const previous = existing.get(p.id);
      if (previous?.analysisKey === analysisKey) { records.push(previous); continue; }
      const record = { ...input, source: 'x', status: 'uncertain', precision: 'unknown', resetAt: null, resetDate: null, timezone: null,
        summary: p.parentId ? 'Tibo 更新了重置相关回复，正在结合前文解释' : 'Tibo 发布了重置相关消息，正在解释原文',
        scope: '', evidence: p.text, timeKind: 'unknown', timePhrase: resetEodPhrase(p.text), timeNote: null,
        parserState: 'pending', analysisKey };
      records.push(record); this.parseQueue.set(p.id, record);
      // A new parser/context revision updates the existing message silently.
      if (before && (!previous || previous.text !== p.text) &&
        (this.now() - Date.parse(p.publishedAt) <= 15 * 60000 || (this.checkedAt && Date.parse(p.publishedAt) >= this.checkedAt - 300000 && !before.has(p.id)))) {
        if (!this.unread.includes(p.id)) this.unread.push(p.id);
        notices.push(record);
      }
      if (records.length >= 60) break;
    }
    this.records = records.slice(0, 60);
    for (const id of this.parseQueue.keys()) if (!this.records.some(p => p.id === id)) this.parseQueue.delete(id);
    this.unread = this.unread.filter(id => this.records.some(p => p.id === id && p.isReset !== false));
    return notices;
  }
  save() {
    const fs = require('node:fs'), path = require('node:path');
    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true, mode: 0o700 });
    const temp = this.cacheFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, posts: this.posts, records: this.records, unread: this.unread, checkedAt: this.checkedAt, enabled: this.enabled, state: this.state, error: this.error || null, diagnostics: this.diagnostics || [] }), { mode: 0o600 });
    fs.renameSync(temp, this.cacheFile);
  }
  snapshot() {
    const records = new Map((this.fallbackSnapshot.records || []).map(p => [p.id, p]));
    for (const p of this.records) {
      if (p.isReset === false) records.delete(p.id);
      else if (this.now() - Date.parse(p.publishedAt) < 14 * 86400000) records.set(p.id, p);
    }
    return { ...this.fallbackSnapshot, source: 'x', xEnabled: true, xState: this.state, xError: this.error || null, xCheckedAt: this.checkedAt,
      state: this.state === 'ready' ? 'ready' : this.fallbackSnapshot.state || 'loading',
      error: this.state === 'ready' ? null : this.fallbackSnapshot.error,
      records: [...records.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 60),
      unreadIds: this.unread, latestPostAt: this.posts[0]?.publishedAt || this.fallbackSnapshot.latestPostAt,
      notification: this.notification || null, pollSeconds: this.pollMs / 1000, xRetryAt: this.state === 'error' ? this.nextRead : null };
  }
  async publish() { if (!this.stopped) await this.onChange(this.snapshot()); }
  start() {
    if (this.child || this.stopped || !this.enabled) return;
    const fs = require('node:fs'), path = require('node:path');
    const windows = process.platform === 'win32';
    const binary = path.join(__dirname, windows ? 'windows/bridge.cjs' : 'native/bridge');
    const script = path.join(__dirname, 'native/collector.js');
    if (!['darwin', 'win32'].includes(process.platform) || !fs.existsSync(binary) || !fs.existsSync(script)) {
      this.state = 'error'; this.error = '当前安装包缺少本平台的 X 采集组件'; this.nextRead = this.now() + 300000; return;
    }
    const child = this.spawn(windows ? process.execPath : binary,
      windows ? [binary, script, this.options.proxyUrl || '', this.options.edgePath || ''] : [script, this.options.proxyUrl || ''],
      { stdio: ['pipe', 'pipe', 'ignore'], ...(windows ? { windowsHide: true } : {}) });
    this.child = child; this.helperLastSeen = this.now(); let buffer = '';
    const fail = () => {
      if (this.child !== child) return;
      this.child = null; this.cyclePending = false;
      if (windows) { if(child.stdin.writable)child.stdin.end('{"action":"stop"}\n'); }
      else child.kill();
      if (!this.stopped) { this.state = 'error'; this.error = 'X 采集组件已停止，稍后自动重试'; this.nextRead = this.now() + 60000; this.publish().catch(() => {}); }
    };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 3 * 1024 * 1024) { fail(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { this.helperLastSeen = this.now(); this.receive(JSON.parse(line)); } catch { this.state = 'error'; this.error = 'X 数据处理失败，旧消息已保留'; this.publish().catch(() => {}); }
      }
    });
  }
  send(action, id) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ action, ...(id ? { id } : {}) }) + '\n'); }
  receive(message) {
    if (this.stopped) return;
    if (message.type === 'heartbeat') return;
    if (message.type === 'cycle') {
      if (!this.enabled) return;
      this.cycleStarted = this.now(); this.cycleToken = message.cycle ?? null; this.cyclePending = true;
      this.mainCheckedAt = null; this.repliesCheckedAt = null; return;
    }
    if (message.cycle !== undefined && this.cycleToken !== null && message.cycle !== this.cycleToken) return;
    if (message.type === 'diagnostic') {
      this.diagnostics = [...(this.diagnostics || []), { operation: String(message.operation || '').slice(0, 80), status: message.status, page: message.page, at: this.now() }].slice(-15);
      this.save(); return;
    }
    if (message.type === 'posts' && this.enabled) {
      if (!['UserTweets', 'UserOriginalsTimeline', 'UserTweetsAndReplies', 'UserRepliesTimeline', 'TweetDetail'].includes(message.endpoint)) return;
      const posts = this.normalize(message.posts);
      if (!posts.length) { this.failure(0); return; }
      const before = new Map(this.posts.map(p => [p.id, p]));
      const merged = new Map(before);
      for (const p of posts) merged.set(p.id, { ...p, firstSeenAt: before.get(p.id)?.firstSeenAt || this.now() });
      this.posts = [...merged.values()].filter(p => this.now() - Date.parse(p.publishedAt) < 14 * 86400000).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 500);
      const notices = this.refreshRecords(before);
      if (notices.length) {
        const latest = notices.sort((a,b) => b.publishedAt.localeCompare(a.publishedAt))[0];
        this.notification = { key: `${latest.id}:${this.now()}`, id: latest.id, text: latest.text.slice(0, 180), at: this.now() };
      }
      if (['UserTweets', 'UserOriginalsTimeline'].includes(message.endpoint)) this.mainCheckedAt = this.now();
      if (['UserTweetsAndReplies', 'UserRepliesTimeline'].includes(message.endpoint)) this.repliesCheckedAt = this.now();
      const complete = this.mainCheckedAt !== null && this.mainCheckedAt !== undefined && this.repliesCheckedAt !== null && this.repliesCheckedAt !== undefined &&
        this.mainCheckedAt >= (this.cycleStarted ?? 0) && this.repliesCheckedAt >= (this.cycleStarted ?? 0);
      if (complete) {
        this.checkedAt = Math.min(this.mainCheckedAt, this.repliesCheckedAt);
        const thread = this.records.find(p => !p.parentId && this.now() - Date.parse(p.publishedAt) < 86400000);
        if (thread && this.now() - (this.lastThreadAt || 0) >= 120000) this.pendingThread = { id: thread.id, at: this.now() + 25000 };
      }
      if (complete) { this.cyclePending = false; this.state = 'ready'; this.error = null; this.failures = 0; this.nextRead = this.nextRead > this.now() ? Math.min(this.nextRead, this.now() + this.pollMs) : this.now() + this.pollMs; }
      this.save(); this.publish().catch(() => {}); this.drainParser();
    } else if (message.type === 'disconnect-failed') {
      this.state = 'error'; this.error = '专用 X 浏览器尚未正常退出，登录信息尚未清除。请关闭专用窗口后重试断开。';
      this.save(); this.publish().catch(() => {});
    } else if (message.type === 'state' && ['login-required', 'loading', 'disconnected'].includes(message.state) &&
      (this.enabled ? message.state !== 'disconnected' : message.state === 'disconnected')) {
      this.state = message.state; this.error = null; this.save(); this.publish().catch(() => {});
    } else if (message.type === 'failure' && this.enabled) this.failure(message.status);
    else if (message.type === 'unsupported') { this.state = 'error'; this.error = 'X 直接采集需要 macOS 14 或更新版本'; this.publish().catch(() => {}); }
  }
  failure(status) {
    this.cyclePending = false; this.failures++; this.state = status === 401 ? 'login-required' : 'error';
    this.error = status === 429 ? 'X 暂时限制请求，正在等待重试' : status === 401 ? 'X 登录已失效，请重新连接' : status === 403 ? 'X 需要验证，请打开连接窗口检查' : '未能读到 X 的帖子与回复；请打开连接窗口检查网络或验证页面';
    this.nextRead = this.now() + Math.min(this.pollMs * 2 ** Math.min(this.failures, 3), 10 * 60000);
    this.save(); this.publish().catch(() => {});
  }
  async drainParser() {
    if (this.parsing || this.stopped || !this.parse || !this.parseQueue.size) return;
    this.parsing = true; const epoch = this.epoch;
    const batch = [...this.parseQueue.values()].slice(0, 8);
    for (const p of batch) this.parseQueue.delete(p.id);
    try {
      const results = await this.parse(batch, this.controller.signal);
      if (!Array.isArray(results)) throw new Error('Invalid parser result');
      if (this.stopped || epoch !== this.epoch) return;
      for (const p of batch) {
        const result = results.find(r => r?.id === p.id);
        const current = this.records.find(r => r.id === p.id);
        if (current?.analysisKey !== p.analysisKey) continue;
        if (!result) { current.parserState = 'failed'; continue; }
        const parsed = validateResetResult(result, p);
        if (parsed) Object.assign(current, parsed, { isReset: true, parserVersion: RESET_PARSER_VERSION, parserState: 'done' });
        else {
          Object.assign(current, { isReset: false, parserVersion: RESET_PARSER_VERSION, parserState: 'done' });
          this.unread = this.unread.filter(id => id !== p.id);
          if (this.notification?.id === p.id) this.notification = null;
        }
      }
    } catch {
      if (epoch === this.epoch) for (const p of batch) { const current = this.records.find(r => r.id === p.id); if (current?.analysisKey === p.analysisKey && current.parserState === 'pending') current.parserState = 'failed'; }
    } finally {
      this.parsing = false;
      if (!this.stopped && epoch === this.epoch) { this.save(); await this.publish(); }
      if (!this.stopped && this.parseQueue.size) this.drainParser();
    }
  }
  async action(action) {
    if (action === 'connect' && this.state !== 'disconnecting') { this.enabled = true; this.state = 'loading'; this.error = null; this.start(); this.send('connect'); this.save(); }
    else if (action === 'refresh') { if (this.now() < (this.lastManual || 0) + 15000) return; this.lastManual = this.now(); this.nextRead = 0; if (this.enabled) for (const r of this.records) if (r.parserState === 'failed') this.parseQueue.set(r.id, r); }
    else if (action === 'read') { this.unread = []; this.notification = null; this.save(); }
    else if (action === 'disconnect') {
      this.enabled = false; this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.parseQueue.clear(); this.send('disconnect');
      this.state = this.child ? 'disconnecting' : 'disconnected'; this.error = null; this.unread = []; this.notification = null; this.save();
    }
    await this.publish();
  }
  async tick() {
    if (this.stopped) return;
    // Fallback and source reads never wait for model parsing or each other.
    this.fallback.tick().catch(() => {});
    if (this.enabled) this.drainParser();
    // A live OS process can still have a wedged WebKit or pipe. Restart our
    // helper only; never remove the persistent store during recovery.
    if (this.enabled && this.child && ((process.platform !== 'win32' && this.helperLastSeen !== null && this.now() - this.helperLastSeen > 90000) ||
      (this.cyclePending && this.now() - this.cycleStarted > 120000))) {
      const child = this.child; this.child = null; this.cyclePending = false;
      if (process.platform === 'win32') child.stdin.end('{"action":"stop"}\n'); else child.kill('SIGTERM');
      this.failure(0); return;
    }
    if (this.enabled && this.state === 'ready' && this.checkedAt && this.now() - this.checkedAt > Math.max(180000, this.pollMs * 3)) {
      this.state = 'error'; this.error = 'X 数据已过期，正在重新检查；下方保留上次消息'; this.save(); await this.publish();
    }
    if (this.enabled && this.state === 'ready' && this.pendingThread && this.now() >= this.pendingThread.at) {
      this.send('thread', this.pendingThread.id); this.pendingThread = null; this.lastThreadAt = this.now();
    }
    if (this.enabled && this.now() >= this.nextRead) { this.nextRead = this.now() + this.pollMs; this.start(); this.send('refresh'); await this.publish(); }
  }
  async wake() {
    if (this.stopped || !this.enabled) return;
    this.cyclePending = false; this.helperLastSeen = this.now(); this.nextRead = this.now();
    this.state = 'loading'; this.error = null; this.send('wake'); await this.publish();
    await this.tick();
  }
  stop() {
    this.stopped = true; this.epoch++; this.controller.abort(); this.fallback.stop(); this.send('stop');
    const child = this.child; this.child = null;
    if (process.platform !== 'win32') child?.kill('SIGTERM');
    if (child && child.exitCode === null) {
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 12000); timer.unref();
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.stdin.end();
      });
    }
  }
}
