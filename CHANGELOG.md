# 版本记录

## 0.3.0 — 开发测试版，尚未发布 Release

- 新增 macOS 原生菜单栏 App，默认独立于 Codex/ChatGPT，安装时固定本机 Node 以减少客户端更新的影响。
- 修复菜单被屏幕裁切的问题：固定顶部与底部，中间滚动，并在真实弹出菜单中验证长内容和矮屏幕。
- 加入私有管道后台、会话保留、断线重试、采集卡住恢复及睡眠唤醒检查。
- 新增 Windows 原生 WinForms 托盘 App，可从 Mac 构建 x64 / ARM64，自包含 .NET 和校验后的 Node。
- 保留可选侧边栏与历史安装路径，升级和卸载保留设置、消息及专用 X 登录。
- 补充原生布局、后台生命周期、展示模型、安装回滚及包内容检查，整理使用、开发和交付文档。

当前仍缺少 macOS 分发签名/公证、Windows 签名及目标环境完整验收，详见 [交付检查](docs/DELIVERY.md)。

## 0.2.0 — Windows 历史开发预览

- 提供 Windows 脚本后台、专用 Edge 采集、当前用户启动和显式客户端启动入口。
- 保留 Windows 实机验收限制，见 [历史 Release](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/tag/v0.2.0-windows-preview)。

## 0.1.1 — macOS 旧侧边栏版

- 独立的 Tibo 公告侧边栏与采集后台、安装迁移及校验打包。
- [历史 Release](https://github.com/LLLLAAAA2333/reset-message-in-codex/releases/tag/v0.1.1)。
