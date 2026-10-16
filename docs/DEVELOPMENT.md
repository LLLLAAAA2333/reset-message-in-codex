# 开发与构建

项目只处理 Tibo 的公开公告，独立于旧 badge 项目。源代码与包内均不得加入真实配置、缓存、日志、认证数据，测试使用隔离目录与合成消息。不要强制关闭用户的桌面客户端。

## 目录

```text
src/                     共享公告、X 采集、解释、连接与私有管道协议
native/                  macOS 菜单栏 UI、展示模型、X 与启动辅助程序
windows/Tray/            Windows 原生 WinForms 托盘 UI 与展示模型
windows/                 独立 Edge 采集器、安装器、历史后台与固定工具版本
scripts/                 构建、打包及交付检查
tests/                   隔离回归、原生布局和安装测试
docs/                    开发、交付及兼容说明
.build/                  本地工具链、编译输出与测试报告（忽略）
dist/                    本地 ZIP 与 SHA256 校验文件（忽略）
```

共享后台无 npm 运行时依赖。Playwright 仅用于开发测试，不进入安装包。macOS App 通过私有标准输入/输出管道管理 Node 后台；Windows 托盘 App 复用相同协议，强制独立模式，并与历史后台使用同一个用户互斥锁。

## 环境与常用命令

- Node 24.14+；使用 `npm ci` 安装锁定版本的开发依赖。
- Python 3.9+。
- macOS 原生构建需要 macOS 14+ 和 Xcode 命令行工具中的 Swift、AppKit / SwiftUI SDK。
- Windows 原生构建使用 `windows/toolchain.json` 固定的 .NET SDK；Mac 上可自动下载官方版本并验证 SHA512。Windows 或其他构建主机需安装匹配 SDK，或用 `TIBO_DOTNET` 指定。

```sh
npm ci
npx playwright install chromium

# macOS 通用 App（Apple Silicon + Intel）
python3 scripts/build.py
npm test
python3 scripts/package.py

# Windows x64 + ARM64 原生托盘 App
python3 scripts/windows_app.py --test-model
python3 scripts/windows_app.py --arch all --package

# 已生成三份安装包后，检查包并执行本机可运行的回归测试
python3 scripts/audit_delivery.py --run-tests
```

也可使用 `npm run build`、`npm run package`、`npm run build:windows`、`npm run package:windows`、`npm run test:windows-model`、`npm run audit:delivery`。只构建一种 Windows 架构时用 `--arch x64` 或 `--arch arm64`。

macOS 输出在 `.build/TiboReset/`，Windows 共享后台在 `.build/TiboReset-Windows/`，原生 Windows App 在 `.build/TiboReset-Windows-x64/` 和 `.build/TiboReset-Windows-arm64/`。可运行对应的 `app.cjs` 调试；必须用 `TIBO_RESET_DATA_DIR` 指向临时目录隔离真实数据。

## 在 Mac 上构建 Windows App

Swift / AppKit 界面依赖 macOS，不能直接生成 Windows UI。Windows 使用独立的 C# / WinForms 前端，复用 Node 公告后台与专用 Edge 采集器。

微软支持在其他操作系统构建 Windows 目标：启用 [`EnableWindowsTargeting`](https://learn.microsoft.com/en-us/dotnet/core/tools/sdk-errors/netsdk1100)，用 [`dotnet publish` 的自包含发布](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview) 为 `win-x64`、`win-arm64` 分别生成应用。这里使用常规 .NET 发布，不依赖 Wine，也不采用跨操作系统的 Native AOT。Mac 不能运行 Windows Forms，编译成功不能替代 Windows 桌面验收。

构建器将 SDK、NuGet 缓存和中间文件放在 `.build/`，不修改全局工具。Windows Node 从官方固定地址下载并核对 SHA256，安装包保留 Node 与 .NET 许可证；不分发 SDK、开发缓存或用户数据。

历史脚本包使用 `python3 scripts/build.py --platform windows` 与 `python3 scripts/package.py --platform windows`，可以在带 Python 的机器上生成，但不包含原生托盘 EXE。新 App 使用 `windows_app.py`。

## 测试范围

`npm test` 在 macOS 验证共享逻辑、浏览器连接、原生展示模型、App 生命周期、菜单真实布局、启动保护和安装回滚。菜单测试覆盖长内容、动态错误、矮屏幕、固定顶部/底部与空状态，不打开真实 X 登录存储。

使用现有 Chrome 时可设置 `PLAYWRIGHT_EXECUTABLE_PATH`。在 Mac 上额外验证 Windows 采集代码：

```sh
python3 scripts/build.py --platform windows
TIBO_TEST_WINDOWS=1 npm test
```

这些测试使用临时浏览器配置和合成页面，不登录真实 X，也不操作真实 Codex。`python3 scripts/windows_app.py --test-model` 可在 Mac 运行 Windows 纯展示模型的语义、时区和日期测试。

在交互式 Windows 11 桌面构建匹配架构后，运行 `node tests/windows-tray.cjs` 检查原生布局、独立后台和正常退出；或设置 `TIBO_WINDOWS_APP=1` 运行 `npm test`。测试禁用真实 X，真实登录、限流/验证、登录启动、升级/卸载和 ARM64 硬件仍需另行验收。

`node tests/startup-icon.cjs` 会短暂打开独立的临时测试应用，验证旧侧边栏的原图标启动与保护条件，不操作真实 Codex。常规 `npm test` 不打开此测试窗口。

GitHub Actions 默认运行 macOS。手动运行测试工作流并勾选 `test_windows` 时，额外构建 Windows x64 原生 App、运行其验收入口并保留 ZIP 校验产物。具体是否通过以对应提交的 Actions 结果为准；CI 不覆盖真实 X 登录和 ARM64 硬件。

## 保持兼容的约定

- 修改注入行为时递增 `src/sidebar.js` 的版本。
- macOS X 辅助程序安装名保留 `bridge`，专用 WebKit store 标识不变，避免升级丢失会话。
- macOS 菜单固定视口应位于状态图标所在屏幕内；先设置 `NSPopover.contentSize` 再调整内容视图，并用实际 `--layout-test` 验证。
- 模型设置、公开消息缓存与登录在升级时保留；不得同时运行两个使用同一登录存储的采集器。
- Windows 使用当前用户启动快捷方式与互斥锁，先请求正常退出再升级，不终止既有桌面客户端。
