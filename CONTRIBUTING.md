# Contributing

Thanks for helping improve Codex Android MCP.

## Before a pull request

1. Open an issue for behavior or security-boundary changes. Report vulnerabilities privately through [SECURITY.md](./SECURITY.md).
2. Keep the server STDIO-only and local-first. Do not add raw shell/ADB, arbitrary commands, broad filesystem access, implicit physical-device selection, or policy-changing tools.
3. Preserve the upstream MIT attribution and mark substantially modified inherited files in the pull request.
4. Add tests that prove both the positive path and a denied/injection path without touching a real device.
5. Run:

```sh
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

Real-device tests must use a disposable emulator. Never commit `.env`, `.npmrc`, `local.properties`, keystores, adb keys, screenshots, logs, absolute user paths, or device serials.

## Code style

- TypeScript strict mode; ESM imports include `.js` extensions.
- Fixed executable plus argv arrays for child processes. Avoid shell command strings.
- Validate before any effect and cap all untrusted output while collecting it.
- Return actionable bounded errors without credentials, typed text, or full host paths.
- Keep stdout protocol-clean; diagnostics go to stderr.

By submitting a contribution, you agree that it may be distributed under this project's MIT License.

