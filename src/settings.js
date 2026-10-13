const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const DATA_DIR = process.env.TIBO_RESET_DATA_DIR || path.join(os.homedir(), 'Library/Application Support/TiboReset');
function readSettings(file = path.join(DATA_DIR, 'settings.json')) {
  const value = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('settings.json 必须是对象');
  const port = value.port ?? 39222, xPollSeconds = value.xPollSeconds ?? 60;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('调试端口无效');
  if (!Number.isFinite(xPollSeconds) || xPollSeconds < 60 || xPollSeconds > 900) throw Error('采集间隔须为 60–900 秒');
  const displayTimezone = value.displayTimezone || 'Asia/Shanghai';
  new Intl.DateTimeFormat('zh-CN', { timeZone: displayTimezone });
  for (const field of ['model', 'codexBin', 'appPath']) if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) throw Error(`${field} 必须是非空字符串`);
  if (value.proxyUrl) {
    const proxy = new URL(value.proxyUrl);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password) throw Error('代理须为不含密码的 HTTP(S) 地址');
  }
  if (value.foloFeedId !== undefined && (typeof value.foloFeedId !== 'string' || !/^\d{1,25}$/.test(value.foloFeedId))) throw Error('Folo ID 无效');
  return { port, xPollSeconds, displayTimezone, proxyUrl: value.proxyUrl, model: value.model, codexBin: value.codexBin,
    appPath: value.appPath, feedUrl: value.foloFeedId ? foloResetFeedUrl(value.foloFeedId) : '', pollMs: 900000 };
}
function findDesktop(explicit) {
  const candidates = explicit ? [explicit] : ['/Applications/Codex.app', '/Applications/ChatGPT.app', path.join(os.homedir(), 'Applications/Codex.app'), path.join(os.homedir(), 'Applications/ChatGPT.app')];
  for (const app of candidates) {
    const resources = path.join(app, 'Contents/Resources');
    const node = path.join(resources, 'cua_node/bin/node');
    const codex = ['codex-cli/bin/codex', 'codex-cli/CodexCLI.app/Contents/MacOS/codex', 'codex'].map(p => path.join(resources, p)).find(p => fs.existsSync(p));
    if (fs.existsSync(node) && codex) return { app, node, codex };
  }
  throw Error('找不到 Codex/ChatGPT 桌面客户端内置运行环境，请设置 appPath');
}
