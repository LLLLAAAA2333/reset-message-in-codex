# 交付检查

v0.3.0 当前定位为开发测试版。源码上传 GitHub 不代表已正式发布安装包，也不代表 Windows 实机验收完成。

## 已完成的本机检查

在 Apple Silicon Mac 上已完成以下检查：

- macOS 通用 App 编译；真实弹出菜单覆盖长消息、动态错误、矮屏幕与固定顶部/底部，解决菜单截断问题。
- 共享公告逻辑、侧边栏兼容、浏览器连接、X 断线恢复、独立管道、后台生命周期、安装迁移和回滚回归。
- Windows x64 / ARM64 原生 GUI EXE 交叉编译，验证 EXE 与 Node 架构，核对官方运行环境校验值和许可证。
- Windows 展示模型及隔离安装器测试；Windows 采集代码在 Mac 的真实 Chromium 连接中使用合成页面验证。
- 三份 ZIP 的文件白名单、包内清单、外部 SHA256、用户数据排除及可执行文件完整性检查。

这些检查不包含真实 Windows 桌面或 Windows X 登录，不能从 PE 文件有效或安装器模拟测试推断完整运行体验。

## 正式交付前的待办

| 平台 | 待完成 |
| --- | --- |
| macOS | Developer ID 签名、Apple 公证、干净系统安装与升级、Intel 实机测试 |
| Windows x64 | Windows 11 交互桌面、真实 X 登录与重连、通知、登录启动、升级/卸载、Authenticode 签名与分发信任 |
| Windows ARM64 | 上述 Windows 检查，以及 ARM64 实机测试 |

macOS 当前是本机临时签名，签名完整性检查通过不代表 Gatekeeper 接受。Windows 当前无 Authenticode 签名。尚未完成以上验收的包不标为稳定版。

## 重复检查

先按 [开发指南](DEVELOPMENT.md) 生成三个原生安装包，再运行：

```sh
python3 scripts/audit_delivery.py --run-tests
```

本地报告位于 `.build/delivery-audit.json`，记录运行时间、测试结果、安装包校验值、签名状态与待验收项目。该报告和测试截图不入库，避免把本机信息与过期包校验值当成发布事实。

目标平台验收时，应在干净用户环境检查首次安装、第二次启动排重、正常退出、保留数据的升级/卸载、睡眠唤醒、断网恢复，以及 X 要求验证时的提示。不得导出真实 Cookie 或将认证数据作为验收附件上传。

安装包通过 GitHub Release 管理；Git 仓库只存源码、测试和文档。已发布的旧版回退入口见 [兼容与迁移](COMPATIBILITY.md)。
