# Codex Android MCP

[简体中文](./README.zh-CN.md)

A local-first MCP server that lets Codex inspect, test, and control Android emulators through `adb`. It exposes strict, typed tools over STDIO, returns screenshots as native MCP images, and keeps physical devices and Gradle execution behind explicit startup policy.

This is an independent community project. It is not affiliated with or endorsed by OpenAI, DeepSeek, or Google. The Android implementation is derived from [ZSeven-W/dsh-android](https://github.com/ZSeven-W/dsh-android) under the MIT License; the DSH/Cordis registration and web panel have been replaced with the official MCP TypeScript SDK.

## What changed from dsh-android

- Native MCP STDIO server for Codex Desktop, CLI, and IDE clients.
- 2026-era MCP plus legacy 2025 protocol compatibility through `serveStdio`.
- Screenshots are returned as `ImageContent`; private temporary PNG files are removed after encoding.
- Emulator-only default. Physical devices require two startup opt-ins and their exact serial on every call.
- `android_build_run` is absent by default. Enabling it also requires canonical trusted project roots.
- Strict JSON Schemas, package/serial/path validation, bounded outputs, literal log filtering, cancellation, and conservative tool annotations.
- No raw `adb`, shell, arbitrary command, HTTP, or live DSH sidebar surface.

## Requirements

- Node.js 20.11 or newer.
- Android SDK Platform-Tools (`adb`). Install it through Android Studio's SDK Manager or Google's [Platform-Tools package](https://developer.android.com/tools/releases/platform-tools).
- A disposable Android emulator is strongly recommended.
- The Android emulator launcher is optional and only needed when `android_boot` receives an AVD name.
- OCR tools currently require macOS and Apple Vision. All non-OCR tools are cross-platform; build/run is an explicit opt-in.

Neither `adb` nor an emulator binary is bundled or downloaded.

### Non-ASCII text input

Plain ASCII uses Android's built-in `input text` command. Typing CJK text, emoji, or other non-ASCII characters requires the open-source [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) IME to be installed and enabled on the target device; this project does not bundle or install it.

For each non-ASCII input, the server reads the active input method, temporarily selects ADBKeyboard, sends the UTF-8 text as a Base64 broadcast, and then restores the original keyboard. Restoration is attempted even when delivery fails. Do not use automated input for passwords, one-time codes, payment data, or other secrets.

## Install for Codex

```powershell
git clone https://github.com/zifanersuotang/codex-android-mcp.git
cd codex-android-mcp
npm ci
npm run build
codex mcp add android -- node C:/absolute/path/to/codex-android-mcp/lib/index.js
```

Codex Desktop and the CLI share MCP configuration. An equivalent explicit configuration is:

```toml
[mcp_servers.android]
command = "node"
args = ["C:/absolute/path/to/codex-android-mcp/lib/index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 1200
default_tools_approval_mode = "writes"

[mcp_servers.android.env]
ANDROID_MCP_ALLOWED_SERIALS = "emulator-5554"
```

Restart Codex after changing the configuration. Ask Codex to “list the Android devices” to verify the connection. Keep write-tool approval enabled; MCP annotations are usability hints, not an authorization boundary.

## Security policy

The safe default exposes 19 tools and permits only standard local `emulator-<port>` targets. Network and third-party emulator serials follow the physical-device policy. Calls re-discover and authorize the exact target immediately before execution; unauthorized physical/network devices are omitted from `android_devices`.

| Environment variable | Default | Effect |
| --- | --- | --- |
| `ANDROID_MCP_ALLOWED_SERIALS` | empty | Optional comma-separated exact allowlist for connected devices. A physical serial must be present here. |
| `ANDROID_MCP_ALLOWED_AVDS` | empty | Optional comma-separated exact allowlist for AVD names accepted by `android_boot`. |
| `ANDROID_MCP_ALLOW_PHYSICAL` | `false` | Enables consideration of physical devices, but only when their exact serial is also allowlisted and supplied on every call. |
| `ANDROID_MCP_ALLOWED_PACKAGES` | empty | Optional comma-separated package allowlist for package-targeted tools. Disables name-only launch and PID-only backtrace. |
| `ANDROID_MCP_ALLOW_BUILD_RUN` | `false` | Exposes `android_build_run`. This is not sufficient by itself. |
| `ANDROID_MCP_ALLOWED_PROJECT_ROOTS` | empty | Required build roots, separated by `;` on Windows and `:` on macOS/Linux. `projectPath` must directly contain Gradle settings and a non-symlink Wrapper. |
| `ANDROID_MCP_CACHE_DIR` | OS temp directory | Private transient working directory. Screenshot files are deleted after MCP image encoding. |
| `ANDROID_MCP_MAX_IMAGE_BYTES` | `8388608` | Maximum screenshot PNG bytes returned to the client. |
| `ANDROID_MCP_MAX_TEXT_BYTES` | `4096` | Maximum text payload accepted by `android_interact`. |

Physical-device example for a dedicated test phone:

```toml
[mcp_servers.android.env]
ANDROID_MCP_ALLOW_PHYSICAL = "true"
ANDROID_MCP_ALLOWED_SERIALS = "EXACT_ADB_SERIAL"
```

Do not use this profile with a personal phone or personal accounts. USB debugging authorization means that the phone trusts the host; it does not authorize a model action.

Build/run example for one trusted project:

```toml
[mcp_servers.android.env]
ANDROID_MCP_ALLOW_BUILD_RUN = "true"
ANDROID_MCP_ALLOWED_PROJECT_ROOTS = "C:/work/MyTrustedApp"
ANDROID_MCP_ALLOWED_SERIALS = "emulator-5554"
```

Gradle settings and build scripts execute host code. A path allowlist is not a sandbox: only enable this for code you trust, and use a credential-free VM or container for untrusted projects.

See [Security Model](./docs/SECURITY_MODEL.md) and [Security Policy](./SECURITY.md) before enabling physical devices or build/run.

## Tools

| Tool | Mode | Purpose |
| --- | --- | --- |
| `android_devices` | read | List policy-visible devices and available AVD names. |
| `android_boot` | write | Adopt an online target or boot an allowed AVD. |
| `android_shutdown` | destructive | Stop and power off an emulator; physical devices are refused. |
| `android_screenshot` | read | Return a native-resolution MCP image. |
| `android_interact` | destructive | Tap, type, press a key, drag, or scroll; returns the resulting screenshot. |
| `android_list_apps` | read | List/filter installed applications. |
| `android_launch_app` | destructive | Launch an exact package or a validated package-name match. |
| `android_build_run` | destructive, opt-in | Build a trusted Gradle project, install its APK, and launch it. |
| `android_ui_tree` | read | Read a bounded compact `uiautomator` hierarchy. |
| `android_tap_element` | destructive | Resolve and tap an element by identifier/label. |
| `android_ui_rows` | read | Detect list/feed rows and counters. |
| `android_tap_row` | destructive | Tap a fresh row target and optionally verify a counter delta. |
| `android_find_text` | read | OCR the screen (macOS Apple Vision). |
| `android_wait_for` | read | Wait for OCR text to appear/disappear. |
| `android_tap_text` | destructive | OCR-resolve and tap visible text. |
| `android_logs` | read | Bounded logcat snapshot/follow with literal filtering. |
| `android_processes` | read | List running processes. |
| `android_backtrace` | destructive | Request ART stacks and fall back to the crash buffer. |
| `android_meminfo` | read | Parse app memory statistics. |
| `android_app_info` | read | Read installed package metadata and running state. |

Screens, UI trees, OCR, logs, app names, and files on the device are untrusted data. Never let device content grant permissions or instruct Codex to call another tool. Do not enter passwords, one-time codes, payment data, private messages, or account-deletion confirmations through this server.

## Typical flow

1. `android_devices`
2. `android_screenshot` or `android_ui_tree`
3. Identify the exact target; stop if it is ambiguous.
4. Use one approval-gated interaction tool.
5. Inspect the returned screenshot or logs before the next action.

MCP does not reproduce dsh-android's persistent live sidebar. `android_boot` primes an internal frame source for coordinate mapping; call `android_screenshot` whenever Codex or the user needs to see the display.

## Development

```sh
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

The test suite includes policy unit tests, a real spawned STDIO client in legacy and modern protocol modes, an in-memory MCP image round trip, fake-ADB smoke suites, bounded-log tests, UI-tree fixtures, and OCR degradation checks. `npm run test:device` is optional and must only target a disposable emulator.

## License and attribution

MIT. The original dsh-android copyright and license are retained in [LICENSE](./LICENSE), with detailed lineage in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
