# Third-Party Notices

## ZSeven-W/dsh-android

This project is a modified derivative of [ZSeven-W/dsh-android](https://github.com/ZSeven-W/dsh-android), reviewed from upstream commit `8c1d19a0019f2fbf65265ac8a09225d0b2fdf8c4` (2026-08-24). Runtime Android/ADB, UI-tree, list-row, OCR, logcat, debug parsing, application, and Gradle modules were copied or adapted. The DSH/Cordis registration, web routes, and React panel were removed and replaced with an MCP STDIO adapter and a startup policy layer.

Original copyright:

```text
Copyright (c) 2026 ZSeven—W
```

License: MIT. The complete original license text is retained in the root [LICENSE](./LICENSE) and separately in [LICENSES/MIT-ZSeven-W.txt](./LICENSES/MIT-ZSeven-W.txt).

## dsh-ios OCR helper lineage

`assets/ocr.swift` was carried through dsh-android from [ZSeven-W/dsh-ios](https://github.com/ZSeven-W/dsh-ios), also MIT licensed. It uses Apple's Vision framework on macOS and is not built or used on Windows/Linux.

## Android SDK Platform-Tools

No Android SDK binary is bundled or downloaded. At runtime the user supplies Google's `adb` and, optionally, the Android emulator launcher. Obtain them from [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) and review the [Android SDK terms](https://developer.android.com/studio/terms).

## ADBKeyboard

No ADBKeyboard code or APK is bundled. If a user independently installs [senzhk/ADBKeyBoard](https://github.com/senzhk/ADBKeyBoard) on a test device, this server may interoperate with its documented `ADB_INPUT_B64` broadcast for non-ASCII input. ADBKeyboard is Apache-2.0 licensed.

## MCP TypeScript SDK and npm dependencies

The project depends on the official [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and its declared npm dependency graph. Installed packages retain their own license files. The production package does not vendor `node_modules`.
