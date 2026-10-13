// Runs inside the monitor's dedicated WebKit view. Only public post fields leave it.
function extractXTimeline(data) {
  const posts = new Map(), visited = new Set();
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 40 || visited.size >= 20000 || visited.has(value)) return;
    visited.add(value);
    const legacy = value.legacy, user = value.core?.user_results?.result;
    const name = user?.core?.screen_name || user?.legacy?.screen_name;
    if (legacy && /^\d+$/.test(value.rest_id || '') && name?.toLowerCase() === 'thsottiaux' && !legacy.retweeted_status_result) {
      const text = value.note_tweet?.note_tweet_results?.result?.text || legacy.full_text;
      const date = Date.parse(legacy.created_at);
      if (typeof text === 'string' && text.trim() && Number.isFinite(date)) posts.set(value.rest_id, {
        id: value.rest_id, author: 'thsottiaux', authorId: user.rest_id,
        url: `https://x.com/thsottiaux/status/${value.rest_id}`, text: text.slice(0, 12000),
        publishedAt: new Date(date).toISOString(),
        parentId: legacy.in_reply_to_status_id_str || null,
        conversationId: legacy.conversation_id_str || value.rest_id
      });
    }
    for (const [key, child] of Object.entries(value)) {
      // Embedded quotes and reposts are not new posts by the monitored author.
      if (!['quoted_status_result', 'retweeted_status_result'].includes(key)) visit(child, depth + 1);
    }
  }
  visit(data);
  return [...posts.values()].slice(0, 200);
}
function installXCollector() {
  if (window.__tiboXCollector) return;
  window.__tiboXCollector = true;
  const send = value => window.webkit?.messageHandlers?.tiboX?.postMessage
    ? window.webkit.messageHandlers.tiboX.postMessage(value)
    : typeof window.__tiboXSend === 'function' ? window.__tiboXSend(value) : undefined;
  function endpoint(value) {
    try {
      const u = new URL(value, location.href);
      if (u.protocol !== 'https:' || !['x.com', 'api.x.com'].includes(u.hostname)) return null;
      return /\/graphql\/[^/]+\/(UserTweets|UserOriginalsTimeline|UserTweetsAndReplies|UserRepliesTimeline|TweetDetail)$/.exec(u.pathname)?.[1] || null;
    } catch { return null; }
  }
  const allowed = kind => ['UserTweets', 'UserOriginalsTimeline', 'UserTweetsAndReplies', 'UserRepliesTimeline', 'TweetDetail'].includes(kind);
  function receive(url, status, body) {
    const kind = endpoint(url);
    if (!kind) return;
    if (!allowed(kind)) return;
    if (status !== 200) { send({ type: 'failure', status }); return; }
    try {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      const posts = extractXTimeline(data);
      if (!posts.length) { send({ type: 'failure', status: 0 }); return; }
      send({ type: 'posts', endpoint: kind, posts });
    } catch { send({ type: 'failure', status: 0 }); }
  }
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url);
    const kind = endpoint(url);
    if (kind) send({ type: 'diagnostic', operation: kind, status: response.status });
    if (allowed(kind)) response.clone().text().then(body => { if (body.length <= 8 * 1024 * 1024) receive(url, response.status, body); }).catch(() => {});
    return response;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      try { const kind = endpoint(this.responseURL); if (kind) send({ type: 'diagnostic', operation: kind, status: this.status }); if (allowed(kind)) receive(this.responseURL, this.status, this.responseType === 'json' ? this.response : this.responseText); } catch {}
    }, { once: true });
    return open.apply(this, args);
  };
}
