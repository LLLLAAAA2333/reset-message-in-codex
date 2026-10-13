# Tibo Reset

在 Codex 侧边栏查看 Tibo（`@thsottiaux`）的重置公告，并及时接收主帖与回复提醒。

独立项目，只做 X 采集、解释、显示与提醒。不包含会话 Token、额度圆环、项目配色，也不读取对话正文或账户额度。代码来源说明见 [ORIGINS.md](ORIGINS.md)。

## macOS 下载与安装

支持 macOS 14+，Apple Silicon 和 Intel 使用同一个通用安装包。需要已安装的 Codex/ChatGPT 桌面应用，且其中包含 Node 和 Codex CLI。公告解释需要 Codex CLI 已登录且有可用额度。不需要另外安装 Node、编译工具、浏览器、RSSHub 或购买 X API。

[下载最新 macOS 正式版](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/latest)。macOS 正式安装包为 **v0.1.1**。Windows 11 安装步骤见下文：

- [TiboReset-macOS-0.1.1.zip](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.1.1/TiboReset-macOS-0.1.1.zip)：可直接安装的程序。
- [SHA256SUMS.txt](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.1.1/SHA256SUMS.txt)：安装包校验值。

Release 页面中的 `Source code` 是源码归档。直接安装请选择上面的 `TiboReset-macOS-0.1.1.zip`。

1. 将 ZIP 和 `SHA256SUMS.txt` 下载到同一个目录。在终端进入该目录，运行 `shasum -a 256 -c SHA256SUMS.txt`，确认输出 `TiboReset-macOS-0.1.1.zip: OK`。
2. 解压 ZIP，打开里面的 `TiboReset` 文件夹，双击 `安装.command`。终端显示已安装后，后台会随用户登录自动运行。已有旧 badge 安装时，按下文的迁移步骤安装。
3. 像往常一样从原来的 Codex 图标打开客户端。已开启侧边栏连接的窗口可直接使用；安装前已经打开、尚未启用连接的窗口需要你自行退出客户端后重新打开。
4. 在侧边栏找到 Tibo Reset，点击 `↺`，选择“连接 / 查看 X”，在专用窗口内登录 X。完成登录后关闭该窗口，等待采集。默认每 60 秒检查一次，电脑睡眠、网络故障或 X 验证会延迟更新。
5. 双击 `诊断.command` 检查状态。后台正常时 `running` 和 `health.startup.running` 应为 `true`；已连接的窗口数见 `health.connectedWindows`，X 状态见 `health.xState`。

当前安装包的原生程序采用本机临时签名，尚未做 Apple Developer ID 签名或公证。若 macOS 因无法验证开发者而拦截，在确认下载来源和校验值后，可按 [Apple 的说明](https://support.apple.com/zh-cn/102445)，到“系统设置 → 隐私与安全性”选择“仍要打开”。

安装成功后可以删除下载和解压目录，程序已复制到 `~/Library/Application Support/TiboReset/`。升级时下载新版本，再运行其中的 `安装.command`，已有设置、缓存和登录存储会保留。

## Windows 11 下载与安装

Windows 版提供 **v0.2.0 Windows 预览版**，适配原生桌面环境，使用 Windows Node 和独立 Edge 配置目录。自动化测试覆盖后台安装、升级、卸载和 Chromium 采集流程；实际桌面客户端的侧边栏与 X 账号登录需要在你的 Windows 电脑上确认。

- [Windows 预览版 Release](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/tag/v0.2.0-windows-preview)
- [TiboReset-Windows-0.2.0.zip](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.2.0-windows-preview/TiboReset-Windows-0.2.0.zip)
- [SHA256SUMS-Windows.txt](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.2.0-windows-preview/SHA256SUMS-Windows.txt)

需要 Windows 11、Microsoft Edge 和带原生 Codex CLI 的 Codex/ChatGPT 桌面客户端。安装器优先使用现有 Node 24.14+；找不到时，从 Node.js 官方下载固定版本并核对随包提供的 SHA256，保存在本用户的程序目录，不修改系统 PATH，不需要管理员权限。可用于 x64 和 ARM64，当前 Windows CI 使用 x64。

1. 下载 ZIP 和对应的校验文件，在同一个目录中用 PowerShell 核对：

   ```powershell
   $tiboExpected = (Get-Content .\SHA256SUMS-Windows.txt -Raw).Trim().Split(' ')[0]
   $tiboActual = (Get-FileHash .\TiboReset-Windows-0.2.0.zip -Algorithm SHA256).Hash.ToLowerInvariant()
   if ($tiboActual -ne $tiboExpected) { throw '安装包校验失败' }
   ```

2. 解压 ZIP，进入 `TiboReset` 文件夹，双击 `install.cmd`。需要下载 Node 时，等待下载和校验完成。看到已安装后，可删除下载及解压目录。
3. 使用安装器创建的桌面快捷方式 **Codex - Tibo Reset**，或双击 `launch-codex.cmd`，打开带本机连接参数的桌面客户端。若客户端正在运行但没有侧边栏连接，先自行保存工作并退出，再运行启动脚本。
4. 点击侧边栏的 `↺ → 连接 / 查看 X`，在专用 Edge 窗口中自行登录。关闭该窗口后，采集会使用同一个独立配置目录在后台继续运行。Windows 的 X 登录需要在本机完成，不拷贝 macOS 的登录存储。
5. 运行 `status.cmd`，查看 `running`、`health.connectedWindows`、`health.xState` 和 `windows` 中的 `placed`。`running=true` 表示后台运行，窗口数大于 0 且 `placed=true` 才表示侧边栏已放置；X 状态单独确认。

Windows 数据目录是 `%LOCALAPPDATA%\TiboReset\`，安装时限制目录 ACL。后台通过当前用户的启动文件夹快捷方式运行，使用互斥锁防止重复启动；升级和卸载通过退出请求正常停用后台。Windows 的 `health.startup.mode` 为 `manual-launch`，每次打开客户端时使用配套的桌面快捷方式。macOS 的原图标启动监听沿用现有实现。

若无法自动找到客户端或 CLI，让 agent 在本机 `settings.json` 中设置 `appPath` 为桌面程序 `.exe`，`codexBin` 为原生 CLI `.exe`；两者不能指向同一个文件。可选 `edgePath` 指定 Edge 程序路径。桌面客户端更新后若安装位置改变，可在退出 Tibo Reset 后修正路径，再运行 `install.cmd`。桌面程序需要允许本机 CDP 调试接口，并使用兼容的侧边栏 DOM；诊断未连接时不能视为安装已完整生效。

升级时运行新安装包中的 `install.cmd`。`uninstall.cmd` 停用后台、移除配套快捷方式和侧边栏，保留设置、公开消息缓存及 X 登录。侧边栏“断开 X”会关闭专用浏览器并删除该配置目录。普通 Edge 配置和 macOS WebKit 命名存储独立保留。

包内 `.cmd` 用单次 PowerShell 进程执行配套脚本，不修改系统的执行策略。企业设备若限制脚本、调试接口或 Edge 远程调试，需要按本机管理规则处理，安装器不会改写这些策略。

### Windows agent 安装 Prompt

```text
请在这台 Windows 11 电脑上安装 Tibo Reset Windows 预览版，使用原生 Windows 桌面环境：
仓库：https://github.com/LLLLAAAA2333/reset-message-in-codex
Release：https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/tag/v0.2.0-windows-preview

1. 阅读该 tag 的 README。确认 Windows 11、Microsoft Edge，以及已安装的 Codex/ChatGPT 桌面程序和其原生 Codex CLI。这里用 Windows PowerShell 和 Windows Node，不用 WSL。
2. 在独立临时目录中下载同一 Release 的 TiboReset-Windows-0.2.0.zip 与 SHA256SUMS-Windows.txt，用 Get-FileHash 验证 ZIP 的 SHA256，校验失败就停止。不要用 macOS ZIP 或 Source code 归档代替。
3. 解压后阅读 install.cmd、windows/bootstrap.ps1、windows/manage.cjs 和 windows/runtime.json。agent 可用无需按键暂停的等价命令安装：powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\bootstrap.ps1 -Action install。没有合适的 Node 时，允许安装器下载其指定的 Node 官方 ZIP，并核对固定哈希；不另行安装构建工具，不修改系统 PATH 或全局执行策略。
4. 若自动检测失败，用 Get-AppxPackage/Get-AppxPackageManifest 或实际安装目录定位桌面 .exe，并在应用资源目录中定位原生 CLI .exe。仅在本机 %LOCALAPPDATA%\TiboReset\settings.json 中填写 appPath、codexBin，必要时填写 edgePath，然后重试安装。保持现有 model 设置，不上传或展示真实配置、缓存、日志、认证文件或 Cookie。
5. 运行 status.cmd，分别报告后台 running、health.version、health.startup.mode、health.connectedWindows、windows 中的 placed 和 health.xState。后台运行不等于侧边栏已连接，也不等于 X 已登录。该版本的 startup.mode 应为 manual-launch。
6. 引导我用桌面的 Codex - Tibo Reset 快捷方式或 launch-codex.cmd 打开客户端。如果当前客户端已运行却未连接，先完成后台安装和诊断，提醒我自行保存并退出，再运行启动脚本。不要强制终止桌面客户端，不要用 taskkill /F、Stop-Process 或改写其安装文件。
7. 引导我在侧边栏点击 ↺ → 连接 / 查看 X，在专用 Edge 窗口自行登录，再关闭窗口。不要索要密码、读取/导出 Cookie，也不要导入日常 Edge 或 macOS 的登录存储。
8. 若桌面调试接口未开启或侧边栏 placed=false，如实报告当前客户端版本的兼容情况和具体诊断结果，不宣称配置完成，不改模型或关闭系统安全检查。保留现有数据及安装器的回滚文件。

最后报告版本、校验结果、安装目录、后台/侧边栏/X 各自的状态，以及我还需要手动完成的步骤。升级用 install.cmd，卸载用 uninstall.cmd；卸载应保留本地数据。
```

<a id="交给-agent-安装的-prompt"></a>

## macOS agent 安装 Prompt

把下面整段复制给能操作本机终端的 agent。它负责下载、校验、安装和诊断；X 登录由你在专用窗口完成。

```text
请在这台 Mac 上安装 Tibo Reset，使用下面仓库的最新正式 GitHub Release：
https://github.com/LLLLAAAA2333/reset-message-in-codex
https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/latest

请先阅读该版本的 README，再完成以下操作：
1. 检查 macOS 是否为 14 或以上，并确认已安装的 Codex/ChatGPT 桌面应用包含 cua_node/bin/node 和 Codex CLI。优先使用桌面应用内置运行环境，无需安装 Node 或编译源码。
2. 在独立的临时目录中，从同一个 Release 下载 TiboReset-macOS-<版本>.zip 和 SHA256SUMS.txt。记录实际 tag 和文件名，运行 shasum -a 256 -c SHA256SUMS.txt；校验失败就停止安装，不执行包内文件。不要下载 Source code 归档代替安装包。
3. 解压安装包，阅读包内 README.md、安装.command 和 manage.cjs。首次安装 Tibo Reset 且存在此前的 CodexUsageBadge 安装时，在解压后的 TiboReset 目录运行 ./安装.command --import-badge，由安装器停用旧后台、迁移公告配置并保留原文件。没有旧安装，或已经安装过 Tibo Reset 时，运行 ./安装.command。
4. 保留现有模型设置和桌面应用文件，不导出、打印或上传认证信息、X Cookie、真实配置、缓存或日志。不要强制关闭 Codex/ChatGPT，不要执行 killall 或 kill -9，不要关闭系统安全检查。若 macOS 拦截，告知我需要在系统设置中手动允许的具体文件。
5. 安装后运行 ./诊断.command。确认 running=true、health.version 与下载版本一致、health.startup.running=true，并报告 health.connectedWindows 和 health.xState。后台安装成功、侧边栏已连接和 X 已登录是三个独立状态，请分别报告。
6. 如果当前 Codex 窗口没有侧边栏连接，先完成后台安装和诊断，再提醒我自行退出客户端并从原图标重新打开。不要为了连接侧边栏结束我正在使用的客户端。需要时可在我自行退出后使用包内 启动Codex.command。
7. 引导我在侧边栏点击 ↺ → 连接 / 查看 X 并自行登录，完成后关闭登录窗口。不要索要密码或 Cookie；已有可用 X 登录时无需重新登录，也不要执行“断开 X”。

最后告诉我下载版本、校验结果、安装目录、后台/侧边栏/X 各自的状态，以及还需要我手动完成的步骤。若遇到问题，保留安装器的回滚和原文件，报告具体错误，不用反复重装或强制重启客户端。
```

## 日常使用

新消息先显示原文和未读提醒，模型随后解释。卡片保留状态标题、原文、前文、原帖链接和发布时间，原文与前文采用衬线斜体引用样式。解释调用已登录的 Codex CLI，会消耗其模型额度，不要求 OpenAI API Key。作者的重置公告不代表你的个人账户已经完成重置。

侧边栏的 `↺` 菜单可刷新消息、连接或查看 X，也可断开 X。打开消息面板会标记已读，原帖链接可查看出处。“断开 X”会清除该专用会话，需要再次登录后才能继续采集。

后台登录时自动运行，内置启动监听器，无需另装程序。原图标打开后，监听器会在客户端刚启动、尚未交互时请求正常退出并带本机连接参数重新打开，可能短暂闪动一次。它不会处理安装前已打开的窗口、已开始输入的窗口或其他应用，也不会强制退出、改动客户端文件或替换图标。保护条件触发时，本次启动会跳过；可以自行退出后再从原图标打开。包内 `启动Codex.command` 仅保留作备用。

侧边栏依赖打开的 Codex 窗口和仅监听本机的调试端口。客户端未打开时仍会采集并保存未读，重新连接后可查看；当前提醒为应用内提示，并非系统通知。

时间默认显示为北京时间。`2026-10-12 EOD PST` 显示为“计划于2026-10-13 16:00前完成（北京时间，按日末估算）”。EOD 没有精确钟点，该时间只按原文日期结束的边界估算，缓存仍保留日级精度。悬停标题可查看 PST/夏令时的歧义说明；原文保留不变。明确的 PT 使用太平洋当地夏令时规则。发布时间也换算为北京时间，悬停可查看原始时间戳。

## 配置与数据

macOS 独立目录：`~/Library/Application Support/TiboReset/`。后台服务：`com.tiboreset.monitor`。Windows 使用 `%LOCALAPPDATA%\TiboReset\` 和当前用户的启动文件夹。

`settings.json` 支持 `port`（默认 39222）、`xPollSeconds`（60–900）、`displayTimezone`、`proxyUrl`、`model`、`codexBin`、`appPath`。可选 `foloFeedId` 用于保留 Folo 备用源，默认直接采集 X。修改配置后重新运行安装器以重启后台。

原文、分类和未读缓存保存在本机，macOS 文件权限为 0600，Windows 使用目录 ACL。X Cookie 留在各平台的专用浏览器存储，不进入缓存、模型输入或日志。macOS 双击 `卸载.command` 停用后台并移除侧边栏，保留本地数据供恢复。已删除下载目录时，可重新下载同版本安装包，用其中的卸载脚本操作。

## 从此前安装迁移

在解压后的 `TiboReset` 文件夹打开终端，执行 `./安装.command --import-badge`。这个脚本会使用桌面客户端内置的 Node，不需要系统另装 Node。迁移只导入公告配置和公开消息缓存，停用此前 badge 后台及其启动/更新任务，保留旧目录和文件。新程序运行时不读取旧目录。迁移失败会恢复旧任务状态，迁移不会导出登录 Cookie。

迁移时沿用已有 WebKit 命名存储来尝试保留 X 登录。请勿同时运行新旧采集器，也不要在旧安装中执行“断开 X”或清除会话的卸载操作。

## 常见问题

| 情况 | 处理方式 |
| --- | --- |
| 侧边栏没有出现 | 运行 `诊断.command`。若后台正常但 `health.connectedWindows` 为 0，自行退出 Codex 后从原图标重开；仍未连接时，退出后使用 `启动Codex.command`。 |
| 安装时提示找不到内置运行环境 | 确认 Codex/ChatGPT 桌面应用已安装。若应用在非默认位置，可让 agent 在 `settings.json` 中指定 `appPath`，再用该应用内置的 Node 执行 `manage.cjs install`。 |
| X 要求登录或验证 | 用 `↺ → 连接 / 查看 X` 打开专用窗口，手动完成登录或验证，再关闭窗口等待采集。 |
| 有原文，模型解释一直未完成 | 检查 Codex CLI 登录状态、可用额度和网络。无需更换模型或填入 OpenAI API Key。 |
| 后台未运行或安装器报告回滚 | 保留具体错误，运行 `诊断.command` 排查。安装器会尝试恢复切换前状态，避免连续重装或手动删除旧安装。 |

## 开发

```sh
python3 scripts/build.py
npm install
npm test
python3 scripts/package.py
```

Windows 源码构建与打包可在任意带 Python 的机器运行，不需要 Swift：

```sh
python3 scripts/build.py --platform windows
python3 scripts/package.py --platform windows
```

`npm test` 在 Windows 使用 Windows 构建输出，并运行隔离的后台生命周期测试；在 macOS 还会运行原生启动和迁移测试。跨平台 X 测试只使用临时浏览器配置目录和合成页面，不登录真实 X，也不操作真实 Codex。GitHub Actions 同时运行 macOS 与 Windows 测试并保留经过检查的安装包。

macOS 开发需要系统 Swift 编译工具与 Node 24.14+，Windows 构建需要 Python，测试还需要 Node 24.14+。安装包用户不需要编译。源码在 `src/`，原生 macOS X 窗口在 `native/`，Windows 支持在 `windows/`。构建输出为 `.build/TiboReset/` 或 `.build/TiboReset-Windows/`。运行对应的 `app.cjs` 可调试，用 `TIBO_RESET_DATA_DIR` 指向临时目录隔离数据。发布包按白名单打包，不含真实设置、缓存或会话。

`node tests/startup-icon.cjs` 会短暂打开独立的临时测试应用，验证原图标打开、正常退出重开、连接参数及已有窗口保护，不操作真实 Codex。常规 `npm test` 不打开该测试窗口。原图标启动使用 macOS 的 [NSWorkspace.OpenConfiguration](https://developer.apple.com/documentation/appkit/nsworkspace/openconfiguration) 与原生应用生命周期通知。
