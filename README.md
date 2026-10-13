# Tibo Reset

在 Codex 侧边栏查看 Tibo（`@thsottiaux`）的重置公告，并及时接收主帖与回复提醒。

独立项目，只做 X 采集、解释、显示与提醒。不包含会话 Token、额度圆环、项目配色，也不读取对话正文或账户额度。代码来源说明见 [ORIGINS.md](ORIGINS.md)。

## 使用

首版支持 macOS 14+，Apple Silicon 和 Intel。需要已安装的 Codex/ChatGPT 桌面应用，不需要另外安装 Node、浏览器、RSSHub 或购买 X API。

1. 解压安装包，双击 `安装.command`。
2. 像往常一样从原来的 Codex 图标打开客户端，侧边栏提醒会自动加载。已开启连接的当前窗口可直接使用。
3. 点击侧边栏的 `↺`，选择“连接 / 查看 X”并登录。关闭登录窗口后继续采集。

新消息先显示原文和未读提醒，模型随后解释。卡片只保留状态标题、原文、前文、原帖链接和发布时间。原文与前文使用衬线斜体引用样式。解释调用已登录的 Codex CLI，会消耗其模型额度；不要求 OpenAI API Key。电脑睡眠、网络故障或 X 验证会延迟采集，60 秒是目标检查间隔。

后台登录时自动运行，内置启动监听器，无需另装程序。原图标打开后，监听器会在客户端刚启动、尚未交互时请求正常退出并带本机连接参数重新打开，可能短暂闪动一次。它不会处理安装前已打开的窗口、已开始输入的窗口或其他应用，也不会强制退出、改动客户端文件或替换图标。保护条件触发时，本次启动会跳过；可以自行退出后再从原图标打开。包内 `启动Codex.command` 仅保留作备用。

侧边栏依赖打开的 Codex 窗口和仅监听本机的调试端口。客户端未打开时仍会采集并保存未读，重新连接后可查看；当前提醒为应用内提示，并非系统通知。

时间默认显示为北京时间。`2026-10-12 EOD PST` 显示为“计划于2026-10-13 16:00前完成（北京时间，按日末估算）”。EOD 没有精确钟点，该时间只按原文日期结束的边界估算，缓存仍保留日级精度。悬停标题可查看 PST/夏令时的歧义说明；原文保留不变。明确的 PT 使用太平洋当地夏令时规则。发布时间也换算为北京时间，悬停可查看原始时间戳。

## 配置与数据

独立目录：`~/Library/Application Support/TiboReset/`。后台服务：`com.tiboreset.monitor`。

`settings.json` 支持 `port`（默认 39222）、`xPollSeconds`（60–900）、`displayTimezone`、`proxyUrl`、`model`、`codexBin`、`appPath`。可选 `foloFeedId` 用于保留 Folo 备用源，默认直接采集 X。修改配置后重新运行安装器以重启后台。

原文、分类和未读缓存保存在本机，权限 0600。X Cookie 留在 WebKit 专用存储，不进入缓存、模型输入或日志。“断开 X”会清除该会话。双击 `诊断.command` 查看连接状态；`卸载.command` 停用后台并移除侧边栏，保留本地数据供恢复。

## 从此前安装迁移

执行 `node manage.cjs install --import-badge`。只导入公告配置和公开消息缓存，停用此前 badge 后台及其启动/更新任务，保留旧目录和文件。新程序运行时不读取旧目录。迁移失败会恢复旧任务状态；迁移不会导出登录 Cookie。

迁移时沿用已有 WebKit 命名存储来尝试保留 X 登录。请勿同时运行新旧采集器，也不要在旧安装中执行“断开 X”或清除会话的卸载操作。

## 开发

```sh
python3 scripts/build.py
npm install
npm test
python3 scripts/package.py
```

开发需要系统 Swift 编译工具与 Node 24.14+；安装包用户不需要编译。源码在 `src/`，原生 X 窗口在 `native/`，构建输出为 `.build/TiboReset/`。运行 `.build/TiboReset/app.cjs` 可调试；用 `TIBO_RESET_DATA_DIR` 指向临时目录隔离数据。发布包按白名单打包，不含真实设置、缓存或会话。

`node tests/startup-icon.cjs` 会短暂打开独立的临时测试应用，验证原图标打开、正常退出重开、连接参数及已有窗口保护，不操作真实 Codex。常规 `npm test` 不打开该测试窗口。原图标启动使用 macOS 的 [NSWorkspace.OpenConfiguration](https://developer.apple.com/documentation/appkit/nsworkspace/openconfiguration) 与原生应用生命周期通知。
