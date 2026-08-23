import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import {
  authorizeToolCall,
  filterDeviceListing,
  loadPolicy,
} from '../lib/policy.js'

const emulator = { serial: 'emulator-5554', state: 'device', emulator: true }
const phone = { serial: 'USB-ABC_123', state: 'device', emulator: false }
const networkEmulator = { serial: '127.0.0.1:5555', state: 'device', emulator: true }

function hostWith(devices) {
  return { toolchain: { listDevices: async () => devices } }
}

function policy(overrides = {}) {
  return {
    allowPhysical: false,
    allowBuildRun: false,
    allowedSerials: new Set(),
    allowedAvds: new Set(),
    allowedPackages: new Set(),
    allowedProjectRoots: [],
    cacheDir: tmpdir(),
    maxImageBytes: 8 * 1024 * 1024,
    maxTextBytes: 4096,
    ...overrides,
  }
}

test('an emulator may be selected implicitly, but a physical device never is', async () => {
  const selected = await authorizeToolCall('android_screenshot', {}, hostWith([emulator]), policy())
  assert.equal(selected.device, emulator.serial)

  await assert.rejects(
    authorizeToolCall('android_screenshot', {}, hostWith([phone]), policy()),
    /no allowed online emulator|exact serial/u,
  )
})

test('physical access requires both the opt-in and an exact allowlisted serial', async () => {
  await assert.rejects(
    authorizeToolCall('android_screenshot', { device: phone.serial }, hostWith([phone]), policy()),
    /physical device access is disabled/u,
  )

  const allowed = policy({ allowPhysical: true, allowedSerials: new Set([phone.serial]) })
  const selected = await authorizeToolCall(
    'android_screenshot',
    { device: phone.serial },
    hostWith([phone]),
    allowed,
  )
  assert.equal(selected.device, phone.serial)
})

test('network and third-party emulator serials follow the physical-device policy', async () => {
  await assert.rejects(
    authorizeToolCall('android_screenshot', {}, hostWith([networkEmulator]), policy()),
    /no allowed online emulator|exact serial/u,
  )
  await assert.rejects(
    authorizeToolCall(
      'android_screenshot',
      { device: networkEmulator.serial },
      hostWith([networkEmulator]),
      policy(),
    ),
    /physical device access is disabled/u,
  )
  const allowed = policy({
    allowPhysical: true,
    allowedSerials: new Set([networkEmulator.serial]),
  })
  const selected = await authorizeToolCall(
    'android_screenshot',
    { device: networkEmulator.serial },
    hostWith([networkEmulator]),
    allowed,
  )
  assert.equal(selected.device, networkEmulator.serial)
})

test('package and text policy rejects injection-shaped or oversized values', async () => {
  await assert.rejects(
    authorizeToolCall(
      'android_launch_app',
      { device: emulator.serial, packageName: 'com.example.app;id' },
      hostWith([emulator]),
      policy(),
    ),
    /dotted Android package/u,
  )
  await assert.rejects(
    authorizeToolCall(
      'android_interact',
      { device: emulator.serial, action: 'type', text: '12345' },
      hostWith([emulator]),
      policy({ maxTextBytes: 4 }),
    ),
    /4-byte policy limit/u,
  )
})

test('build execution is disabled by default and confined by canonical roots', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'codex-android-policy-'))
  const allowedRoot = join(sandbox, 'allowed')
  const project = join(allowedRoot, 'project')
  const sibling = join(sandbox, 'sibling')
  mkdirSync(project, { recursive: true })
  mkdirSync(sibling, { recursive: true })
  writeFileSync(join(project, 'settings.gradle.kts'), 'rootProject.name = "fixture"\n')
  writeFileSync(join(project, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), '', {
    mode: 0o755,
  })
  try {
    await assert.rejects(
      authorizeToolCall(
        'android_build_run',
        { projectPath: project, device: emulator.serial },
        hostWith([emulator]),
        policy(),
      ),
      /disabled by default/u,
    )

    const enabled = loadPolicy({
      ANDROID_MCP_ALLOW_BUILD_RUN: 'true',
      ANDROID_MCP_ALLOWED_PROJECT_ROOTS: allowedRoot.split(delimiter).join(delimiter),
      ANDROID_MCP_CACHE_DIR: join(sandbox, 'cache'),
    })
    const accepted = await authorizeToolCall(
      'android_build_run',
      { projectPath: project, device: emulator.serial },
      hostWith([emulator]),
      enabled,
    )
    assert.equal(accepted.projectPath, project)
    await assert.rejects(
      authorizeToolCall(
        'android_build_run',
        { projectPath: sibling, device: emulator.serial },
        hostWith([emulator]),
        enabled,
      ),
      /outside ANDROID_MCP_ALLOWED_PROJECT_ROOTS/u,
    )
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('device listing hides every device the policy would refuse', () => {
  const listing = {
    devices: [
      { serial: emulator.serial, state: 'device', kind: 'emulator' },
      { serial: phone.serial, state: 'device', kind: 'physical' },
    ],
    count: 2,
    online: [emulator.serial, phone.serial],
    avds: [],
  }
  const filtered = filterDeviceListing(listing, policy())
  assert.equal(filtered.count, 1)
  assert.deepEqual(filtered.online, [emulator.serial])
  assert.deepEqual(filtered.devices.map(device => device.serial), [emulator.serial])
})
