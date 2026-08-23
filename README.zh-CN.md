# Codex Android MCP

[English](./README.md)

这是一个本地优先的 MCP STDIO 服务，让 Codex 通过 `adb` 检查、测试和操控 Android 模拟器。它源自 MIT 许可的 [ZSeven-W/dsh-android](https://github.com/ZSeven-W/dsh-android)，但已经移除 DSH/Cordis 注册层和网页侧栏，改用官方 MCP TypeScript SDK。

本项目是社区项目，不隶属于 OpenAI、DeepSeek 或 Google，也不代表这些组织的官方支持。

## 主要变化

- 同时兼容现代 MCP 与 2025 版 legacy 协议。
- 截图直接返回 MCP `ImageContent`，编码后立即删除私有临时 PNG。
- 默认只允许标准本地 `emulator-<端口>`；网络或第三方模拟器按实体机策略处理。实体机需要“开启开关 + exact serial 白名单 + 每次显式传 serial”。
- `android_build_run` 默认不注册，只有开启开关并配置可信工程根目录后才成为第 20 个工具。
- 集中执行设备、包名、路径和文本策略；没有 raw adb、raw shell、任意命令或 HTTP 接口。
- 写操作串行，日志/树/截图有上限，工具 annotations 采用保守标记。

## 环境要求

- Node.js 20.11 及以上。
- Android SDK Platform-Tools（`adb`），建议通过 Android Studio SDK Manager 安装。
- 强烈建议使用不含个人账号和数据的一次性 AVD。
- 三个 OCR 工具目前依赖 macOS Apple Vision；其余工具跨平台。build/run 另需显式开启。

项目不会捆绑或自动下载 `adb`、模拟器和 ADBKeyboard。

## 安装到 Codex

```powershell
git clone https://github.com/zifanersuotang/codex-android-mcp.git
cd codex-android-mcp
npm ci
npm run build
codex mcp add android -- node C:/绝对路径/codex-android-mcp/lib/index.js
```

也可以直接写入 Codex MCP 配置：

```toml
[mcp_servers.android]
command = "node"
args = ["C:/绝对路径/codex-android-mcp/lib/index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 1200
default_tools_approval_mode = "writes"

[mcp_servers.android.env]
ANDROID_MCP_ALLOWED_SERIALS = "emulator-5554"
```

修改后重启 Codex，然后让 Codex“列出 Android 设备”。请保留写工具审批；MCP annotations 只是客户端提示，不是权限系统。

## 安全配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ANDROID_MCP_ALLOWED_SERIALS` | 空 | 可选的 exact serial 列表，逗号分隔；实体机必须在其中。 |
| `ANDROID_MCP_ALLOWED_AVDS` | 空 | 可选的 AVD 名称白名单，逗号分隔。 |
| `ANDROID_MCP_ALLOW_PHYSICAL` | `false` | 开启实体机候选；仍需 exact serial 白名单，并在每次调用显式传入。 |
| `ANDROID_MCP_ALLOWED_PACKAGES` | 空 | 包名白名单；配置后禁用模糊名称启动和只传 PID 的 backtrace。 |
| `ANDROID_MCP_ALLOW_BUILD_RUN` | `false` | 注册 `android_build_run`。 |
| `ANDROID_MCP_ALLOWED_PROJECT_ROOTS` | 空 | build 必填的可信根目录；Windows 用 `;`，macOS/Linux 用 `:` 分隔。`projectPath` 本身必须包含 Gradle settings 和非符号链接 Wrapper。 |
| `ANDROID_MCP_CACHE_DIR` | 系统临时目录 | 私有工作目录。截图在 MCP 编码后清理。 |
| `ANDROID_MCP_MAX_IMAGE_BYTES` | `8388608` | 单张截图上限。 |
| `ANDROID_MCP_MAX_TEXT_BYTES` | `4096` | 单次输入文本上限。 |

实体机只建议用于专门的测试手机：

```toml
[mcp_servers.android.env]
ANDROID_MCP_ALLOW_PHYSICAL = "true"
ANDROID_MCP_ALLOWED_SERIALS = "精确的_ADB_SERIAL"
```

USB 调试授权只表示手机信任这台电脑，不表示用户授权本次模型操作。不要连接个人手机、个人账号或真实支付环境。

build/run 会执行工程内的 Gradle 配置和脚本，等价于执行主机代码。路径白名单不是沙箱，只能对可信代码开启；不可信工程应放到无凭据、最好断网的虚拟机或容器。

更多边界见 [安全模型](./docs/SECURITY_MODEL.md) 和 [漏洞报告方式](./SECURITY.md)。

## 工具概览

安全默认配置注册 19 个工具：设备发现/启动/关闭、截图与交互、应用列表与启动、UI tree/行/文本定位与点击、logcat、进程、backtrace、meminfo 和 app info。开启可信 build profile 后增加 `android_build_run`，完整共 20 个。

普通 MCP 不会复刻 dsh-android 的常驻直播侧栏。`android_boot` 只会准备设备和内部帧源；需要看画面时调用 `android_screenshot`，交互工具也会返回操作后的截图。

手机画面、UI tree、OCR、日志、应用名和设备文件始终是不可信数据，不能借此扩大权限或指挥 Codex 调用工具。不要通过本服务输入密码、验证码、支付信息、私聊内容或账号删除确认；控件含义不明确时应停止。

## 开发与验证

```sh
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

测试包含策略单测、真实子进程 STDIO 的 legacy/modern 双协议、MCP 图片往返、fake-adb、日志边界、UI tree fixture 和 OCR 降级。`npm run test:device` 只应对一次性模拟器手动运行。

## 许可证

MIT。原始 dsh-android 的版权和许可文本保留在 [LICENSE](./LICENSE)，详细来源见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
