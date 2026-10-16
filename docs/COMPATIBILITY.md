# 兼容与迁移

v0.3.0 默认使用 macOS 菜单栏和 Windows 托盘 App。旧侧边栏模式仍依赖客户端本机调试连接；客户端更新可能影响此兼容路径。

## 已发布的历史版本

- macOS 旧侧边栏正式包：[TiboReset-macOS-0.1.1.zip](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.1.1/TiboReset-macOS-0.1.1.zip) 与 [SHA256SUMS.txt](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/download/v0.1.1/SHA256SUMS.txt)。
- Windows 历史侧边栏开发预览：[v0.2.0 Windows Release](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/tag/v0.2.0-windows-preview)。

不要同时运行旧版与原生 App 的采集器，macOS 两者共用专用 X 登录存储。旧版目录可保留为回退文件，不作为新项目运行时依赖。

## macOS 可选侧边栏

在本机 `settings.json` 设置 `sidebarEnabled: true` 并重新启动 Tibo Reset。兼容模式需要打开的 Codex 窗口和仅监听本机的调试端口。

原图标启动监听器只处理刚启动、尚未交互的前台客户端，可能请求正常退出并带本机连接参数重新打开，短暂闪动一次。它跳过既有窗口、已输入内容、身份不明或保护条件触发的情况，不强制退出、不修改客户端文件、不替换图标。包内 `启动Codex.command` 保留为备用。

侧边栏未出现时，先用 `诊断.command` 确认已启用兼容模式。若后台正常但 `health.connectedWindows=0`，可自行正常退出 Codex，再从原图标或备用启动器打开。原生菜单栏模式的连接数为 0 正常，不需要重启客户端。

Windows 历史脚本后台默认启用侧边栏，通过 **Codex - Tibo Reset** 或 `launch-codex.cmd` 显式启动客户端；新版原生 App 强制独立模式，使用 **Tibo Reset** 快捷方式。不要同时启动两种后台。

## 从旧 badge 首次迁移

仅首次迁移且没有 Tibo Reset 安装时，在解压后的 `TiboReset` 文件夹执行：

```sh
./安装.command --import-badge
```

安装器只导入公告配置与公开消息缓存，停用旧 badge 的后台及启动/更新任务，保留旧目录。新程序运行时不读取旧目录。失败时尝试恢复原任务状态；迁移不导出 Cookie。

macOS 沿用 WebKit 命名存储来尝试保留 X 登录，不保证 X 服务端不会撤销登录。不要在旧安装中断开 X 或运行清除会话的卸载操作。已有 Tibo Reset 安装直接运行新版安装器升级，无需再次导入。

## 交给 agent 的 macOS 安装 Prompt

```text
请在当前 Tibo Reset 源码目录构建、验证并安装 v0.3.0 菜单栏开发测试版，不要下载旧侧边栏 Release 代替。
1. 阅读 AGENTS.md 和 README。运行 python3 scripts/build.py、npm test，再用构建目录中的安装.command 安装。
2. 已安装 Tibo Reset 时直接升级。仅首次从旧 badge 迁移且没有 Tibo Reset 安装时使用 --import-badge。由安装器正常停用旧后台，不能同时运行两个采集器。
3. 保留模型设置和已有 X 登录；不要打印、上传或打包真实配置、缓存、日志、Cookie。不要关闭 Codex/ChatGPT，不要执行断开 X。
4. 检查 status.json 中 version=0.3.0、mode=menu-bar、startup.running=true，分别报告后台与 xState。菜单栏模式 connectedWindows=0 正常。
5. 只有 X 需要登录或验证时，才引导我打开菜单栏连接窗口并自行操作。分别说明后台、网络和登录状态，不宣称服务端登录永不失效。
6. 说明本机临时签名、尚未公证及交付验收限制，不将开发测试版称为正式稳定版。
```
