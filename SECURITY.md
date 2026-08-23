# Security Policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability report form:

<https://github.com/zifanersuotang/codex-android-mcp/security/advisories/new>

Include the affected commit/version, host OS, Node version, whether a physical device or build/run was enabled, reproduction steps, and impact. Remove device serials, screenshots, logs, credentials, private app data, and exploit payloads that are not necessary to reproduce the issue.

You should receive an acknowledgement through GitHub within seven days. No bounty is promised. Please allow a reasonable remediation and disclosure window.

## Scope and safety boundaries

In scope:

- Bypassing emulator/physical-device, serial, package, or project-root policy.
- Shell/argument injection, arbitrary host execution outside an explicitly enabled trusted Gradle project, or path traversal.
- Reading or returning host files outside the private screenshot cache.
- Leaking typed text, host credentials, environment variables, device content, or physical serials contrary to documented policy.
- Orphaned ADB/Gradle processes after cancellation, protocol desynchronization, or unauthenticated network exposure.
- Resource-exhaustion bugs that bypass documented limits.

Expected behavior, not a vulnerability:

- An explicitly enabled trusted Gradle project can execute arbitrary host code during build.
- Approved UI actions can change app/device state and may trigger network effects.
- Device screens, UI trees, OCR results, logs, package metadata, and process names enter the model context.
- ADB grants broad control to the host independently of this MCP server.
- OCR is unavailable without macOS Apple Vision.

The server intentionally exposes only STDIO and provides no raw shell/ADB tool. It does not bypass Android permissions, secure screens, lock screens, root restrictions, or in-app confirmations.

