# Security Model

## Trust boundaries

The MCP client and server startup configuration are trusted. Tool arguments, model output, Android devices, apps, screens, OCR strings, UI hierarchies, logcat, Gradle projects, PATH entries, and environment overrides are untrusted unless the operator explicitly places them inside a documented allowlist.

MCP tool annotations help the client choose approval behavior; they do not authorize a call. `src/policy.ts` is the authorization boundary and runs again immediately before each handler.

## Device authorization

- Default: standard local `emulator-<port>` serials only. Product strings cannot promote a network or third-party target into this class.
- Connected-device allowlists use case-sensitive exact serial equality. There are no wildcards, regular expressions, or prefix matches.
- Physical/network devices need `ANDROID_MCP_ALLOW_PHYSICAL=true`, membership in `ANDROID_MCP_ALLOWED_SERIALS`, and the exact serial argument on every call.
- A physical device is never chosen through an implicit “only online device” fallback.
- `android_devices` filters out devices the policy would refuse.
- AVD boot names have a narrow character set and can be independently restricted with `ANDROID_MCP_ALLOWED_AVDS`.

For high-risk physical-device testing, run a separate Codex MCP profile with all tools set to prompt. Do not connect personal phones or accounts.

## Host execution

There is no raw `adb`, shell, command, environment, init-script, or arbitrary Gradle-argument tool. Child processes use fixed executables and argv arrays.

`android_build_run` is not registered by default. When enabled, the candidate project path and configured roots are canonicalized before containment checks. Module, variant, task, and application ID values are validated before process creation. Windows batch wrappers are invoked through a fixed `cmd.exe` boundary with separately quoted validated arguments; cancellation terminates the child tree.

These checks limit accidental scope. They do not sandbox Gradle: wrapper, settings, plugin, and build scripts inside an allowed project can execute arbitrary host code. Use a credential-free VM/container for untrusted code.

## Data and privacy

- Screenshot PNGs are written only inside a private server cache because existing OCR/UI handlers require a path. The MCP adapter validates canonical containment, signature, type, and byte size, encodes the image, then removes the temporary file.
- Host screenshot paths and legacy attachment metadata are removed from MCP results. Build result paths are reduced to basenames.
- Typed text is capped and redacted from returned ADB errors on a best-effort basis.
- Log capture is bounded by time, lines, bytes, single-line/partial length, and uses literal substring matching rather than caller-controlled regular expressions.
- UI trees, OCR and debug output have independent caps in the inherited core.

Data returned by these tools still enters the Codex conversation. Server-side filtering cannot reliably identify every password, token, message, notification, or personal detail on a screen or in logs. The operator must use disposable test data.

## Concurrency and cancellation

Read tools may run concurrently. All write/destructive tools are serialized within one server instance. Tool timeouts are combined with the MCP client's cancellation signal. Logcat and Gradle own explicit child-process cleanup paths; the Android host and frame loop are disposed when the MCP connection closes.

## Protocol boundary

The initial release serves STDIO only. Standard output is reserved exclusively for MCP JSON-RPC; diagnostics use standard error. The SDK entry supports both modern MCP negotiation and the 2025 legacy handshake from the same fresh-server factory.

## Non-goals

- Bypassing Android permissions, `FLAG_SECURE`, lock screens, root boundaries, app confirmations, or platform security prompts.
- Protecting a user who explicitly approves a harmful UI action.
- Sandboxing an explicitly enabled Gradle build.
- Reproducing dsh-android's web panel or exposing a network stream.
