# Tibo Reset

在 macOS 菜单栏或 Windows 系统托盘查看 Tibo（`@thsottiaux`）的重置公告，接收主帖与回复提醒。原生 App 独立于 Codex/ChatGPT 桌面客户端；Codex 侧边栏保留为兼容模式。

卡片显示状态标题、原文引用、前文、原帖链接和发布时间，支持展开、滚动及系统明暗主题。项目只做 X 采集、解释、显示与提醒，不读取对话正文或个人账户额度。设计受 [CodexBar](https://github.com/steipete/CodexBar) 启发，代码与资源来源见 [ORIGINS.md](ORIGINS.md)。

## 版本与交付状态

当前源码为 **v0.3.0 开发测试版**。macOS 菜单栏 App 与 Windows x64 / ARM64 托盘 App 均已构建，但尚未发布 v0.3.0 Release。当前版本不能视为已完成正式交付验收：

| 平台 | 已完成 | 待完成 |
| --- | --- | --- |
| macOS 14+，Apple Silicon / Intel | 通用二进制构建、菜单布局及后台回归测试、安装包校验 | Developer ID 签名与公证、干净系统安装、Intel 实机验收 |
| Windows 11，x64 / ARM64 | 在 Mac 交叉编译原生 EXE、架构及运行环境校验、共享后台与展示模型测试 | Windows 桌面和真实 X 登录验收、升级/卸载实机测试、Authenticode 签名 |

详细依据与验收入口见 [交付检查](docs/DELIVERY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。历史回退包见 [兼容与迁移](docs/COMPATIBILITY.md)。

## macOS 菜单栏 App

从源码构建并安装，需要 macOS 14+、系统 Swift 开发工具，以及已安装的 Codex 或 ChatGPT 桌面应用提供首次 Node 运行环境：

```sh
python3 scripts/build.py
.build/TiboReset/安装.command
```

安装到 `~/Applications/Tibo Reset.app`，沿用 `~/Library/Application Support/TiboReset/` 中的设置、公开消息缓存和专用 X 登录。安装器正常停用旧后台，固定一份本机 Node，并使用 `com.tiboreset.monitor` 登录启动任务。之后客户端更新不会删除这份运行环境，采集与原文显示也不要求桌面客户端运行。

1. 点击菜单栏循环箭头图标查看公告。
2. 通过“查看 X 连接…”打开专用窗口，自行完成登录或验证，随后可关闭窗口。
3. “…”菜单可设置登录启动、开启新公告通知、标记已读或退出。通知只在主动开启后申请系统权限。
4. 运行构建目录中的 `诊断.command` 检查后台和 X 状态。`health.mode=menu-bar` 且 `connectedWindows=0` 是正常状态。

菜单采用屏幕内的固定视口，标题与底部操作保持可见，中间消息滚动。直接打开构建目录中的 `Tibo Reset.app` 也能使用；若旧后台仍在运行，应先用安装器迁移，避免两个采集器共用 X 存储。

打包：`python3 scripts/package.py`，生成 `dist/TiboReset-macOS-0.3.0.zip` 与 SHA256 校验文件。macOS 包不附带本机 Node，当前仅使用本机临时签名，尚无 Developer ID 签名及公证。

## Windows 11 托盘 App

分别提供 x64 和 ARM64 构建。原生 WinForms App 的安装包包含 `Tibo Reset.exe`、自包含 .NET 运行环境和固定版本 Node，使用者不需要安装编译工具。X 采集需要 Microsoft Edge。

在 Mac 上构建两个架构：

```sh
python3 scripts/windows_app.py --arch all --package
```

输出 `dist/TiboReset-Windows-x64-0.3.0.zip`、`dist/TiboReset-Windows-arm64-0.3.0.zip` 及各自的 SHA256 校验文件。交叉编译依据与工具准备见 [开发指南](docs/DEVELOPMENT.md#在-mac-上构建-windows-app)。

1. 核对 ZIP 的 SHA256，解压后进入 `TiboReset` 文件夹，双击 `install.cmd`。
2. 安装器写入 `%LOCALAPPDATA%\TiboReset\`，创建当前用户的桌面及登录启动快捷方式，无需管理员权限。
3. 从桌面 **Tibo Reset** 或系统托盘打开公告面板，再通过“连接 / 查看 X…”在专用 Edge 窗口自行登录。Windows 使用独立的登录目录，不复制 macOS WebKit 数据。
4. 运行 `status.cmd`，分别检查后台 `running`、`health.mode=tray`、`health.startup.mode=tray` 和 `health.xState`。托盘模式下 `connectedWindows=0` 正常；后台运行不代表 X 已登录。

托盘菜单提供刷新、连接、登录启动、通知、已读和退出。关闭公告窗口只隐藏面板。升级用新包的 `install.cmd`，安装器先请求旧后台正常退出，失败则保留回滚文件；不会关闭正在使用的 Codex/ChatGPT。

## 日常使用与数据

新消息先显示原文与未读提醒，再调用已登录的 Codex CLI 进行解释，沿用原有模型设置并消耗对应额度，无需 OpenAI API Key。没有可用 CLI 时仍保留原文。作者的重置公告不代表个人账户已经完成重置。

网络失败时保留登录与已有公告并自动重试；采集组件卡住会重新启动，睡眠唤醒后重新检查。X 撤销登录、限流或要求验证时仍需用户操作。“断开 X 并清除登录…”需要确认，只有这个操作删除专用登录。退出、升级和卸载均保留设置、公开消息缓存及登录。

时间默认使用北京时间。EOD 只按原文日期的日末边界估算，并明确显示“按日末估算”；原文保留不变。明确的 PT 按太平洋当地夏令时规则转换，不将 EOD 当成作者承诺的精确钟点。

配置示例见 [settings.example.json](settings.example.json)。本机 `settings.json` 可设置 `xPollSeconds`（60–900）、`displayTimezone`、`proxyUrl`、`model`、`codexBin`、`appPath`；Windows 还支持 `edgePath`。`port` 默认 39222，只用于可选侧边栏连接；`foloFeedId` 是可选备用源。修改设置后可退出再启动 App。macOS 使用 `卸载.command`，Windows 使用 `uninstall.cmd`。

X Cookie 留在各平台的专用浏览器存储，不进入消息缓存、模型输入或日志。真实设置、缓存、日志、认证数据和构建产物均不提交到 Git；发布包按白名单打包。

## 常见问题

| 情况 | 处理方式 |
| --- | --- |
| 原生 App 未显示或后台未运行 | macOS 运行 `诊断.command`，Windows 运行 `status.cmd`，分别检查 App、后台和 X 状态。不要用侧边栏连接数判断原生 App 是否正常。 |
| macOS 首次安装找不到运行环境 | 确认 Codex/ChatGPT 桌面应用已安装。非默认路径可在本机设置中指定 `appPath`，再用该应用内置的 Node 执行 `manage.cjs install`。 |
| X 要求登录或验证 | 从 App 打开专用 X 连接窗口，手动完成后等待采集。自动重试不会清除登录。 |
| 有原文，模型解释一直未完成 | 检查 Codex CLI 登录、可用额度及网络，无需更换模型或填写 API Key。 |
| 仍想使用 Codex 侧边栏 | 参阅 [兼容与迁移](docs/COMPATIBILITY.md)，该模式需要客户端本机调试连接。 |

## 项目导航

- [开发与构建](docs/DEVELOPMENT.md)：目录、命令、Mac 上构建 Windows、测试和持续集成。
- [交付检查](docs/DELIVERY.md)：已验证范围、签名状态、尚需完成的实机验收。
- [兼容与迁移](docs/COMPATIBILITY.md)：历史安装包、旧 badge 迁移、可选侧边栏及安装 Prompt。
- [版本记录](CHANGELOG.md) · [代码来源](ORIGINS.md) · [MIT 许可证](LICENSE)
