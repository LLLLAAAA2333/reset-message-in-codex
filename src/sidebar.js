function installTiboSidebar() {
  const KEY = '__tiboReset', VERSION = 2;
  if (window[KEY]?.version === VERSION) { window[KEY].place(); return; }
  window[KEY]?.destroy?.();
  let snapshot = { state: 'unconfigured', records: [] }, disposed = false, timer, lastPayload;
  const actions = []; let toastTimer, lastNotice;
  const act = action => { if (!actions.includes(action)) actions.push(action); };
  const toast = document.createElement('button'); toast.id = 'tibo-reset-toast'; toast.hidden = true; toast.type = 'button';
  toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  const button = document.createElement('button');
  button.id = 'tibo-reset-announcements'; button.type = 'button'; button.textContent = '↺';
  button.setAttribute('aria-label', 'Tibo 额度重置公告'); button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'tibo-reset-panel');
  const panel = document.createElement('section'); panel.id = 'tibo-reset-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Tibo 额度重置公告');
  const style = document.createElement('style'); style.id = 'tibo-reset-style';
  style.textContent = `
    #tibo-reset-announcements { flex: 0 0 30px; width: 30px; height: 30px; margin: 4px auto; padding: 0;
      border: 1px solid #8885; border-radius: 7px; background: transparent; color: inherit; font: 22px/28px sans-serif; cursor: pointer; }
    #tibo-reset-toast { position: fixed; right: 20px; bottom: 24px; z-index: 2147483000; width: min(360px, calc(100vw - 40px));
      padding: 14px; border: 1px solid #2478ca; border-radius: 10px; background: #edf5ff; color: #173b61;
      box-shadow: 0 4px 20px #0003; font: 13px/1.6 -apple-system, sans-serif; text-align: left; cursor: pointer; }
    #tibo-reset-toast[hidden] { display: none !important; }
    #tibo-reset-panel .x-controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
    #tibo-reset-panel .x-controls button { font: inherit; color: inherit; background: transparent; border: 1px solid #8887; border-radius: 5px; padding: 3px 9px; cursor: pointer; }
    #tibo-reset-announcements[data-state="news"] { color: #2478ca; border-color: #2478ca; }
    #tibo-reset-announcements[data-state="error"] { color: #b88023; }
    #tibo-reset-panel { position: fixed; z-index: 2147482999; box-sizing: border-box; width: min(380px, calc(100vw - 16px));
      max-height: calc(100vh - 24px); overflow: auto; padding: 14px; border: 1px solid #8885; border-radius: 10px;
      background: var(--color-surface-elevated-secondary, #f8f8f7); color: var(--color-text-primary, #303630);
      box-shadow: 0 4px 20px #0003; font: 12px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; }
    #tibo-reset-panel[hidden] { display: none !important; }
    #tibo-reset-panel h3 { margin: 0 0 8px; font-size: 13px; } #tibo-reset-panel p { margin: 6px 0; }
    #tibo-reset-panel article { border-top: 1px solid #8884; padding-top: 8px; margin-top: 10px; }
    #tibo-reset-panel blockquote { margin: 8px 0; padding: 6px 10px; border-left: 2px solid #8885;
      background: #8888880c; overflow-wrap: anywhere; }
    #tibo-reset-panel blockquote p { margin: 3px 0; }
    #tibo-reset-panel .reset-source-label { opacity: .7; }
    #tibo-reset-panel .reset-source-text { font: italic 13px/1.6 Georgia, "Times New Roman", "Songti SC", serif; white-space: pre-wrap; }
    #tibo-reset-panel a { color: #4389cf; } #tibo-reset-panel small { opacity: .7; }
    html.dark #tibo-reset-panel, html[data-theme="dark"] #tibo-reset-panel { background: #2c2e2c; color: #edf0ed; }
    @media(prefers-color-scheme: dark) { html:not(.light):not([data-theme="light"]) #tibo-reset-panel { background: #2c2e2c; color: #edf0ed; } }
  `;
  const displayZone = () => snapshot.displayTimezone || 'Asia/Shanghai';
  const zoneLabel = () => ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin'].includes(displayZone()) ? '北京时间' : displayZone();
  function clockText(value) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: displayZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }
  function sourceDayBoundary(date, zone, nextDay = false) {
    if (!/^\d{4}-\d\d-\d\d$/.test(date || '')) return null;
    let local = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 10) !== date) return null;
    if (nextDay) local += 86400000;
    const fixed = { PST: -480, PDT: -420, UTC: 0, GMT: 0 }[zone];
    if (typeof fixed === 'number') return local - fixed * 60000;
    const offset = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone || '');
    if (offset) {
      const minutes = Number(offset[2]) * 60 + Number(offset[3] || 0);
      if (minutes > 14 * 60 || Number(offset[3] || 0) > 59) return null;
      return local - (offset[1] === '+' ? 1 : -1) * minutes * 60000;
    }
    if (!zone) return null;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone === 'PT' ? 'America/Los_Angeles' : zone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      let utc = local;
      for (let i = 0; i < 4; i++) {
        const p = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
        const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        if (wall === local) return utc;
        utc += local - wall;
      }
    } catch {}
    return null;
  }
  function time(record) {
    if (record.status === 'completed') return '作者宣布重置已完成（账户状态请以客户端为准）';
    if (record.status === 'cancelled') return '重置计划已取消';
    if (record.status === 'uncertain') return '已发布重置相关消息，进度待说明';
    if (record.timeKind === 'window' && record.timePhrase) return `计划时间范围：${record.timePhrase}`;
    if (record.timeKind === 'deadline' && /\bEOD\b|end of (?:the )?day/i.test(record.timePhrase || '')) {
      const end = sourceDayBoundary(record.resetDate, record.timezone, true);
      return end === null ? '计划于所述当天结束前完成（时区或日期不明，无法换算北京时间）'
        : `计划于${clockText(end)}前完成（${zoneLabel()}，按日末估算）`;
    }
    if (record.precision === 'exact' && Number.isFinite(Date.parse(record.resetAt))) {
      return `${record.timeKind === 'deadline' ? '预计最晚完成' : '预计重置'}：${clockText(record.resetAt)}（${zoneLabel()}）${Date.parse(record.resetAt) < Date.now() ? '；公告时间已过，实际是否重置待确认' : ''}`;
    }
    if (record.precision === 'day') {
      const start = sourceDayBoundary(record.resetDate, record.timezone), end = sourceDayBoundary(record.resetDate, record.timezone, true);
      if (start !== null && end !== null) return `预计${record.timeKind === 'deadline' ? '完成期限' : '重置范围'}：${clockText(start)} 至 ${clockText(end)}（${zoneLabel()}，具体时间待定）`;
    }
    if (record.timeKind === 'deadline' && record.timePhrase) return `计划完成期限：${record.timePhrase}`;
    return '有重置消息，具体时间待定';
  }
  function node(tag, text, parent = panel) { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; }
  function render() {
    panel.replaceChildren(); node('h3', 'Tibo · Codex 额度重置');
    const status = { unconfigured: '尚未配置公告来源。请在 settings.json 中填写 Folo 订阅 ID 或 Tibo 的 RSS/Atom 地址。',
      loading: '正在读取公告来源…', error: '公告检查失败；下方保留之前的消息，可能已过期。' }[snapshot.state];
    if (status) node('p', status);
    if (snapshot.error) node('p', snapshot.error);
    if (snapshot.xEnabled) {
      const state = { 'login-required': '请连接 X，登录一次后自动采集', loading: '正在连接 X…', ready: '已连接 X · 自动检查主帖与回复', error: 'X 采集暂不可用', disconnecting: '正在断开 X 并清除登录信息…', disconnected: '已断开 X，登录信息已清除' }[snapshot.xState] || '正在连接 X…';
      node('p', state);
      if (snapshot.xError) node('p', snapshot.xError);
      if (snapshot.xCheckedAt) node('p', `X 上次成功检查：${new Date(snapshot.xCheckedAt).toLocaleString('zh-CN')}`);
      if (snapshot.xState !== 'ready') node('small', '下方可能包含之前的消息或 Folo 备用数据。');
      const controls = node('div', ''); controls.className = 'x-controls';
      for (const [label, action] of [['连接 / 查看 X', 'connect'], ['立即检查', 'refresh'], ['断开 X', 'disconnect']]) {
        const control = node('button', label, controls); control.type = 'button'; control.addEventListener('click', () => { act(action); control.disabled = true; });
      }
      node('small', '登录后可以关闭 X 窗口。新消息会在此处提示；电脑睡眠时暂停检查。');
    }
    if (snapshot.source === 'folo') node('p', '来源：Folo（推文更新由 Folo 服务负责）');
    if (snapshot.latestPostAt) node('p', `最新获取的推文发布于：${new Date(snapshot.latestPostAt).toLocaleString('zh-CN')}`);
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    if (snapshot.state === 'ready' && !records.length) node('p', '最近 14 天的已获取推文中，未识别到额度重置公告。');
    for (const record of records.slice(0, 5)) {
      // The host process validates origin; keep the renderer independently strict.
      if (!/^https:\/\/x\.com\/thsottiaux\/status\/\d+$/.test(record.url)) continue;
      const article = node('article', ''); const heading = node('strong', time(record), article);
      if (record.timeKind === 'deadline' && /\bEOD\b|end of (?:the )?day/i.test(record.timePhrase || '')) {
        heading.title = 'EOD 未给出具体钟点；显示时间按原文日期结束的边界换算，仅作估算。' +
          (record.timezone === 'PST' ? 'PST 按 UTC−8；若作者泛指采用夏令时的太平洋当地时间，换算结果会提前一小时。' : '');
      }
      if (record.parserState === 'pending') node('small', '原文已到达，正在补充解释…', article);
      if (record.parserState === 'failed') node('small', '解释暂不可用，原文仍可查看。', article);
      const quote = node('blockquote', '', article);
      for (const [label, text] of [['原文：', record.text], ...(record.threadContext || []).slice(0, 2).map(parent => ['前文：', parent.text])]) {
        const line = node('p', '', quote);
        node('span', label, line).className = 'reset-source-label';
        node('span', text, line).className = 'reset-source-text';
      }
      const link = node('a', '查看原推文', article); link.href = record.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const published = Number.isFinite(Date.parse(record.publishedAt)) ? `${clockText(record.publishedAt)}（${zoneLabel()}）` : record.publishedAt;
      node('small', ` · 发布于 ${published}`, article).title = record.publishedAt;
    }
    if (snapshot.checkedAt) node('p', `上次成功检查：${new Date(snapshot.checkedAt).toLocaleString('zh-CN')}`);
    const unread = Array.isArray(snapshot.unreadIds) ? snapshot.unreadIds.length : null;
    button.textContent = unread ? `↺${unread}` : '↺';
    button.setAttribute('aria-label', unread ? `Tibo 额度重置公告，${unread} 条未读` : 'Tibo 额度重置公告');
    button.dataset.state = unread ? 'news' : snapshot.xState === 'error' || snapshot.state === 'error' ? 'error' : unread === null && records.length ? 'news' : snapshot.state;
    const notice = snapshot.notification;
    if (notice && notice.key !== lastNotice && Date.now() - notice.at < 60000) {
      lastNotice = notice.key; toast.textContent = `Tibo 有新的重置相关消息：${notice.text}（点击查看）`; toast.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 20000);
    }
    button.title = records.length ? time(records[0]) : status || '暂无已识别的重置公告';
  }
  function place() {
    if (disposed || !document.body) return;
    if (!style.isConnected) (document.head || document.documentElement).append(style);
    if (!panel.isConnected) document.body.append(panel);
    if (!toast.isConnected) document.body.append(toast);
    const rail = [...document.querySelectorAll('nav[data-app-navigation-rail]')].find(el => el.getBoundingClientRect().height > 0);
    const footer = rail && [...rail.children].filter(el => el !== button).at(-1);
    if (!footer) { button.remove(); panel.hidden = true; button.setAttribute('aria-expanded', 'false'); return; }
    if (button.parentElement !== rail || button.nextElementSibling !== footer) rail.insertBefore(button, footer);
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right + 8, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - panel.offsetHeight - 12))}px`;
  }
  function toggle() { panel.hidden = !panel.hidden; if (!panel.hidden && snapshot.xEnabled) act('read'); button.setAttribute('aria-expanded', String(!panel.hidden)); place(); }
  toast.addEventListener('click', () => { panel.hidden = false; toast.hidden = true; button.setAttribute('aria-expanded', 'true'); act('read'); place(); });
  function outside(event) { if (!panel.contains(event.target) && !button.contains(event.target)) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); } }
  function key(event) { if (event.key === 'Escape') { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); } }
  const observer = new MutationObserver(records => { if (records.every(r => panel.contains(r.target) || r.target === toast || r.target === button || r.target === style) || timer) return;
    timer = setTimeout(() => { timer = null; place(); }, 100); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  button.addEventListener('click', toggle); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); window.addEventListener('resize', place);
  window[KEY] = { version: VERSION, place, update(value) {
      const payload = JSON.stringify(value);
      if (payload !== lastPayload) { lastPayload = payload; snapshot = value; render(); }
      place();
    },
    takeActions() { return actions.splice(0, 8); },
    status() { return { version: VERSION, state: snapshot.state, placed: button.isConnected, checkedAt: snapshot.checkedAt ?? null, records: snapshot.records?.length ?? 0, xState: snapshot.xState ?? null, xCheckedAt: snapshot.xCheckedAt ?? null, unread: snapshot.unreadIds?.length ?? 0 }; },
    destroy() { disposed = true; observer.disconnect(); clearTimeout(timer); button.removeEventListener('click', toggle);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', place);
      clearTimeout(toastTimer); toast.remove(); button.remove(); panel.remove(); style.remove(); delete window[KEY]; } };
  render(); place();
}
