/**
 * Static smoke for the dsh-android core tool layer — no real device.
 *
 * A fake `adb` (a Node script written into a mkdtemp directory and prepended
 * to PATH) answers every call the tools make, and records each invocation to a
 * log file so the assertions can check the EXACT device command a tool built:
 * the normalized→pixel conversion, the scroll band clamp, the launch verb.
 * That is the part a shape-only test would miss.
 *
 * Run `pnpm run build` first — this suite imports the COMPILED lib/*.js.
 * When lib is missing (a sibling module still being written) it prints SKIP
 * and exits 0, so a partial tree does not read as a failure.
 */

import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import {
  TINY_PNG_B64,
  createStepReporter,
  expectThrow,
  findJsonViolations,
  makeExec,
  withEnv,
} from './_smoke-harness.mjs'

const { step, finish } = createStepReporter()

/** The fake adb. Unknown calls exit 1 loudly — a silent default would let a
 * tool build the wrong command and still pass. */
const FAKE_ADB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'

const PNG = Buffer.from(${JSON.stringify(TINY_PNG_B64)}, 'base64')
// Keep the compact fixture bytes, but give its IHDR a phone-sized viewport;
// production coordinate mapping now prefers fresh screencap dimensions over
// wm-size output, so a 1x1 image would only exercise rounding to zero.
PNG.writeUInt32BE(1080, 16)
PNG.writeUInt32BE(2400, 20)
const argv = process.argv.slice(2)
const logPath = process.env.DSH_SMOKE_ADB_LOG
if (logPath) appendFileSync(logPath, JSON.stringify(argv) + '\\n')

let rest = argv
let serial
if (rest[0] === '-s') {
  serial = rest[1]
  rest = rest.slice(2)
}
const out = text => process.stdout.write(text.endsWith('\\n') ? text : text + '\\n')
const die = why => {
  process.stderr.write('fake-adb: unhandled ' + why + ': ' + JSON.stringify(argv) + '\\n')
  process.exit(1)
}

if (rest[0] === 'devices') {
  const phoneState = process.env.DSH_SMOKE_PHONE_ONLINE === '1' ? 'device' : 'unauthorized'
  out([
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1',
    'R58M1234ABC            ' + phoneState + ' usb:1-1 transport_id:2',
    '',
  ].join('\\n'))
  process.exit(0)
}
if (rest[0] === 'emu') {
  if (rest[1] === 'avd' && rest[2] === 'name') out('SmokeAvd\\nOK')
  else if (rest[1] === 'kill') out('OK')
  else die('emu')
  process.exit(0)
}
if (rest[0] === 'install') {
  out('Success')
  process.exit(0)
}
if (rest[0] === 'exec-out') {
  const command = rest.slice(1).join(' ')
  if (command.startsWith('screencap')) {
    process.stdout.write(PNG)
    process.exit(0)
  }
  if (command.includes('while :;')) {
    // The persistent frame loop: emit frames until we are signalled.
    const timer = setInterval(() => process.stdout.write(PNG), 60)
    const stop = () => { clearInterval(timer); process.exit(0) }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    process.stdout.write(PNG)
    setTimeout(stop, 20000).unref?.()
    // keep the event loop alive
  } else die('exec-out')
} else if (rest[0] === 'shell') {
  const command = rest.slice(1).join(' ')
  if (command.includes('getprop ro.product.model')) {
    out('sdk_gphone64_arm64\\nGoogle\\n14\\n34')
  } else if (command === 'wm size') {
    out('Physical size: 1080x2400')
  } else if (command.startsWith('input ')) {
    out('')
  } else if (command === 'pm list packages -f') {
    if (process.env.DSH_SMOKE_PM_FAIL === '1') {
      process.stderr.write('cmd: Can\\'t find service: package\\n')
      process.exit(1)
    }
    out([
      'package:/data/app/~~aQ==/dev.example.demo-bB==/base.apk=dev.example.demo',
      'package:/system/priv-app/Settings/Settings.apk=com.android.settings',
      'package:/data/app/~~cC==/dev.example.other-dD==/base.apk=dev.example.other',
      '',
    ].join('\\n'))
  } else if (command === 'pm list packages -s') {
    out('package:com.android.settings\\n')
  } else if (command === 'dumpsys package packages') {
    out([
      'Packages:',
      '  Package [dev.example.demo] (a1b2c3):',
      '    versionCode=7 minSdk=23 targetSdk=35',
      '    versionName=1.2.3',
      '  Package [com.android.settings] (d4e5f6):',
      '    versionCode=34 minSdk=34 targetSdk=34',
      '    versionName=14',
      '',
    ].join('\\n'))
  } else if (command.startsWith('monkey ')) {
    out('bash arg: -p\\nEvents injected: 1')
  } else if (command.startsWith('am force-stop')) {
    out('')
  } else if (command.startsWith('ime list')) {
    out('')
  } else if (command.startsWith('pidof')) {
    out('')
  } else die('shell ' + command)
  process.exit(0)
} else die('verb')
`

const FAKE_EMULATOR = `#!/usr/bin/env node
if (process.argv.includes('-list-avds')) {
  process.stdout.write('SmokeAvd\\nPixel_7_API_34\\n')
  process.exit(0)
}
process.stderr.write('fake-emulator: unhandled ' + JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(1)
`

const shim = mkdtempSync(join(tmpdir(), 'dsh-android-tools-smoke-'))
const adbPath = join(shim, 'adb')
writeFileSync(adbPath, FAKE_ADB, { mode: 0o755 })
chmodSync(adbPath, 0o755)
mkdirSync(join(shim, 'emulator'), { recursive: true })
const emulatorPath = join(shim, 'emulator', 'emulator')
writeFileSync(emulatorPath, FAKE_EMULATOR, { mode: 0o755 })
chmodSync(emulatorPath, 0o755)
const adbLog = join(shim, 'adb-calls.log')
writeFileSync(adbLog, '')

/** Every recorded fake-adb argv, newest last. */
function calls() {
  return readFileSync(adbLog, 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line))
}

/** The last recorded `shell` command matching `needle`, as one string. */
function lastShell(needle) {
  const matches = calls()
    .filter(argv => argv.includes('shell'))
    .map(argv => argv.slice(argv.indexOf('shell') + 1).join(' '))
    .filter(command => command.includes(needle))
  return matches[matches.length - 1]
}

function reset() {
  writeFileSync(adbLog, '')
}

async function main() {
  let adbLib
  let androidHostLib
  let toolSupportLib
  let toolsLib
  let buildRunLib
  let toolDebugLib
  try {
    const compiled = name => pathToFileURL(join(import.meta.dirname, '..', 'lib', `${name}.js`)).href
    ;[adbLib, androidHostLib, toolSupportLib, toolsLib, buildRunLib, toolDebugLib] = await Promise.all([
      import(compiled('adb')),
      import(compiled('android-host')),
      import(compiled('tool-support')),
      import(compiled('tools')),
      import(compiled('build-run')),
      import(compiled('tool-debug')),
    ])
  } catch (error) {
    step('compiled core modules are built', 'SKIP',
      `import failed (${error?.message ?? error}) — run npm run build`)
    finish()
    return
  }
  const { AdbToolchain } = adbLib
  const { AndroidHostController } = androidHostLib
  const { ScreenshotStore, androidScrollPath, gestureDragOf } = toolSupportLib
  const { createAndroidTools } = toolsLib
  const toolCacheDir = join(shim, 'tool-cache')
  const toolScreenshotsDir = join(toolCacheDir, 'screenshots')

  /**
   * Windows cannot exec an extensionless shebang shim. Keep the production
   * AdbToolchain parser and higher-level methods under test, but route its
   * low-level process calls through Node's executable for this fixture only.
   * The same FAKE_ADB program still records and answers the exact adb argv.
   */
  class WindowsFakeAdbToolchain extends AdbToolchain {
    constructor() {
      super({ available: true, source: 'path', command: adbPath })
    }

    fakeChild(argv) {
      return spawn(process.execPath, [
        '--input-type=module', '--eval', FAKE_ADB, 'fake-adb', ...argv,
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    }

    collect(argv) {
      const child = this.fakeChild(argv)
      const stdout = []
      const stderr = []
      child.stdout.on('data', chunk => stdout.push(chunk))
      child.stderr.on('data', chunk => stderr.push(chunk))
      return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => {
          const output = Buffer.concat(stdout)
          const errorOutput = Buffer.concat(stderr)
          if (code !== 0) {
            reject(new Error(errorOutput.toString('utf8').trim() || `fake adb exited ${String(code)}`))
            return
          }
          resolve({ output, errorOutput })
        })
      })
    }

    async exec(args, options = {}) {
      const argv = options.serial === undefined ? [...args] : ['-s', options.serial, ...args]
      const { output, errorOutput } = await this.collect(argv)
      return { stdout: output.toString('utf8'), stderr: errorOutput.toString('utf8') }
    }

    async execOut(serial, command) {
      const { output } = await this.collect(['-s', serial, 'exec-out', ...command])
      return output
    }

    spawnExecOut(serial, command) {
      return this.fakeChild(['-s', serial, 'exec-out', ...command])
    }
  }

  await withEnv({
    ADB: undefined,
    ANDROID_HOME: shim,
    ANDROID_SDK_ROOT: undefined,
    LOCALAPPDATA: process.platform === 'win32' ? join(shim, 'localappdata') : process.env.LOCALAPPDATA,
    PATH: `${shim}${delimiter}${process.env.PATH ?? ''}`,
    DSH_SMOKE_ADB_LOG: adbLog,
    DSH_SMOKE_PM_FAIL: undefined,
  }, async () => {
    const toolchain = process.platform === 'win32' ? new WindowsFakeAdbToolchain() : new AdbToolchain()
    step('the fake adb resolves off PATH', toolchain.available && toolchain.binary.command === adbPath,
      `${toolchain.binary.source}: ${toolchain.binary.command}`)
    const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0 })
    const tools = createAndroidTools(host, { cacheDir: toolCacheDir })

    // 1 ── android_devices: the listing parse and the AVD side-channel.
    const devices = await tools.androidDevices.execute({}, makeExec('android_devices', {}))
    step('android_devices parses both rows of `adb devices -l`',
      devices.count === 2
      && devices.devices[0].serial === 'emulator-5554'
      && devices.devices[0].kind === 'emulator'
      && devices.devices[0].state === 'device'
      && devices.devices[1].state === 'unauthorized'
      && devices.devices[1].kind === 'physical',
      JSON.stringify(devices.devices.map(entry => `${entry.serial}/${entry.state}/${entry.kind}`)))
    step('android_devices enriches the ONLINE row only (getprop is not asked of an unauthorized device)',
      devices.devices[0].androidVersion === '14' && devices.devices[0].name === 'sdk_gphone64_arm64'
      && devices.devices[1].androidVersion === '',
      `online=${devices.devices[0].androidVersion} offline=${JSON.stringify(devices.devices[1].androidVersion)}`)
    step('android_devices reports online serials and the platform\'s AVD discovery result separately',
      Array.isArray(devices.online) && devices.online.length === 1 && devices.online[0] === 'emulator-5554'
      && (process.platform === 'win32'
        ? devices.avds.length === 0
        : devices.avds.includes('SmokeAvd')),
      `online=${JSON.stringify(devices.online)} avds=${JSON.stringify(devices.avds)} note=${devices.note ?? ''}`)
    step('android_devices result is lossless JSON', findJsonViolations(devices).length === 0,
      findJsonViolations(devices).join(', '))

    // 2 ── android_screenshot: the shared cache directory contract.
    reset()
    const shot = await tools.androidScreenshot.execute({}, makeExec('android_screenshot', {}))
    const underRouteDir = shot.path.startsWith(toolScreenshotsDir)
    step('android_screenshot writes into the directory the signed route serves',
      underRouteDir && existsSync(shot.path), `${shot.path} (route dir ${toolScreenshotsDir})`)
    step('android_screenshot returns a summary, never bytes',
      typeof shot.bytes === 'number' && shot.bytes > 0
      && shot.width === 1080 && shot.height === 2400
      && shot.device.serial === 'emulator-5554'
      && !('png' in shot) && !('image' in shot),
      `${shot.bytes} bytes, ${shot.width}x${shot.height}`)
    step('android_screenshot result is lossless JSON', findJsonViolations(shot).length === 0,
      findJsonViolations(shot).join(', '))
    const shotMeta = tools.androidScreenshot.output.presentationMeta({}, shot)
    step('android_screenshot presentationMeta is the android-screenshot envelope',
      shotMeta.kind === 'android-screenshot'
      && shotMeta.path === shot.path
      && shotMeta.screenshotPath === shot.path
      && shotMeta.device.serial === 'emulator-5554',
      JSON.stringify(shotMeta.kind))
    step('android_screenshot render() emits one text block',
      (() => {
        const blocks = tools.androidScreenshot.output.render({}, shot)
        if (blocks.length !== 1 || blocks[0].type !== 'text') return false
        return JSON.parse(blocks[0].text).path === shot.path
      })(), 'text/JSON only')
    rmSync(shot.path, { force: true })

    // 3 ── android_interact: normalized 0..1 → device pixels.
    reset()
    const tapArgs = { action: 'tap', x: 0.5, y: 0.25 }
    const tapped = await tools.androidInteract.execute(tapArgs, makeExec('android_interact', tapArgs))
    step('tap converts 0..1 to pixels with the device screen size (no live frame)',
      lastShell('input tap') === 'input tap 540 600', lastShell('input tap'))
    step('android_interact returns the effect screenshot with the action tag',
      tapped.action === 'tap' && tapped.bytes > 0 && findJsonViolations(tapped).length === 0,
      `${tapped.action} → ${tapped.path}`)
    const tapMeta = tools.androidInteract.output.presentationMeta(tapArgs, tapped)
    step('android_interact presentationMeta reuses the screenshot envelope',
      tapMeta.kind === 'android-screenshot' && tapMeta.path === tapMeta.screenshotPath,
      JSON.stringify(tapMeta.kind))
    rmSync(tapped.path, { force: true })

    reset()
    const scrollArgs = { action: 'scroll', direction: 'down', amount: 0.6 }
    const scrolled = await tools.androidInteract.execute(scrollArgs, makeExec('android_interact', scrollArgs))
    // direction names the CONTENT: "down" moves the finger UP, and the far end
    // clamps into the 8% band so the system nav strip cannot swallow it.
    step('scroll "down" swipes upward and clamps into the gesture-free band',
      lastShell('input swipe') === 'input swipe 540 1200 540 192 300', lastShell('input swipe'))
    rmSync(scrolled.path, { force: true })

    reset()
    const typeArgs = { action: 'type', text: 'hello world' }
    const typed = await tools.androidInteract.execute(typeArgs, makeExec('android_interact', typeArgs))
    step('type escapes spaces for `input text`', lastShell('input text') === 'input text hello%sworld',
      lastShell('input text'))
    rmSync(typed.path, { force: true })

    reset()
    const buttonArgs = { action: 'button', name: 'back' }
    const pressed = await tools.androidInteract.execute(buttonArgs, makeExec('android_interact', buttonArgs))
    step('button maps the Android navigation names to keycodes',
      lastShell('input keyevent') === 'input keyevent KEYCODE_BACK', lastShell('input keyevent'))
    rmSync(pressed.path, { force: true })

    await expectThrow(step, 'a gesture without a normalized from/to pair is refused with the shape that works',
      () => tools.androidInteract.execute(
        { action: 'gesture', json: { type: 'begin', x: 0.5, y: 0.5 } },
        makeExec('android_interact', {}),
      ), /gesture is a drag on Android/)
    await expectThrow(step, 'tap outside 0..1 is refused before it reaches the device',
      () => tools.androidInteract.execute({ action: 'tap', x: 1.5, y: 0.5 }, makeExec('android_interact', {})),
      /must be within 0\.\.1/)
    await expectThrow(step, 'scroll without a direction names the four it accepts',
      () => tools.androidInteract.execute({ action: 'scroll' }, makeExec('android_interact', {})),
      /requires direction "up", "down", "left" or "right"/)

    // 4 ── pure geometry, asserted without a device.
    const up = androidScrollPath({ action: 'scroll', direction: 'up', amount: 1 })
    step('every scroll endpoint stays inside the 8%..92% band',
      [up.fromY, up.toY].every(value => value >= 0.08 - 1e-9 && value <= 0.92 + 1e-9)
      && up.toY > up.fromY,
      JSON.stringify(up))
    step('gestureDragOf defaults the duration and keeps the endpoints',
      (() => {
        const drag = gestureDragOf({ fromX: 0.1, fromY: 0.5, toX: 0.9, toY: 0.5 })
        return drag.duration === 0.3 && drag.fromX === 0.1 && drag.toX === 0.9
      })(), 'duration 0.3 s')

    // 5 ── android_list_apps: enrichment, filtering, and the honest no-match.
    reset()
    const apps = await tools.androidListApps.execute({}, makeExec('android_list_apps', {}))
    step('android_list_apps excludes system packages by default and enriches versions',
      apps.count === 2
      && apps.apps.every(app => app.system === false)
      && apps.apps.find(app => app.packageName === 'dev.example.demo')?.version === '1.2.3'
      && apps.apps.find(app => app.packageName === 'dev.example.demo')?.versionCode === 7,
      `${apps.count} user packages`)
    step('android_list_apps result is lossless JSON', findJsonViolations(apps).length === 0,
      findJsonViolations(apps).join(', '))
    const withSystem = await tools.androidListApps.execute(
      { include_system: true }, makeExec('android_list_apps', {}))
    step('include_system adds the preinstalled packages',
      withSystem.count === 3 && withSystem.apps.some(app => app.packageName === 'com.android.settings' && app.system),
      `${withSystem.count} packages`)
    const noMatch = await tools.androidListApps.execute({ query: '设置' }, makeExec('android_list_apps', {}))
    step('a no-match on a SUCCESSFUL listing explains WHY and lists candidates',
      noMatch.count === 0
      && typeof noMatch.hint === 'string'
      && noMatch.hint.includes('no app label over adb')
      && Array.isArray(noMatch.candidates) && noMatch.candidates.length > 0,
      (noMatch.hint ?? '').slice(0, 90))

    // 6 ── a FAILED listing throws; it must never look like an empty device.
    await withEnv({ DSH_SMOKE_PM_FAIL: '1' }, () => expectThrow(
      step,
      'a failed `pm list packages` throws instead of reporting zero apps',
      () => tools.androidListApps.execute({}, makeExec('android_list_apps', {})),
      /a failed listing is not an empty one/,
    ))

    // 7 ── android_launch_app: the two-ways-to-name-one-app argument gate.
    await expectThrow(step, 'launch with BOTH packageName and name is a ToolArgsError',
      () => tools.androidLaunchApp.execute(
        { packageName: 'dev.example.demo', name: 'demo' }, makeExec('android_launch_app', {})),
      /either packageName or name, not both/)
    await expectThrow(step, 'launch with NEITHER is a ToolArgsError naming the listing verb',
      () => tools.androidLaunchApp.execute({}, makeExec('android_launch_app', {})),
      /android_list_apps/)
    step('both launch argument errors are ToolArgsError instances', await (async () => {
      const kinds = []
      for (const args of [{ packageName: 'a.b', name: 'x' }, {}]) {
        try {
          await tools.androidLaunchApp.execute(args, makeExec('android_launch_app', args))
          kinds.push('none')
        } catch (error) {
          kinds.push(error?.constructor?.name)
        }
      }
      return kinds.every(kind => kind === 'ToolArgsError')
    })(), 'ToolArgsError, not a bare Error')

    reset()
    const launched = await tools.androidLaunchApp.execute(
      { name: 'demo' }, makeExec('android_launch_app', { name: 'demo' }))
    step('launch resolves a package-name fragment and starts the LAUNCHER activity',
      launched.packageName === 'dev.example.demo'
      && launched.matched === 'demo'
      && lastShell('monkey') === 'monkey -p dev.example.demo -c android.intent.category.LAUNCHER 1',
      lastShell('monkey'))
    await expectThrow(step, 'an ambiguous fragment lists the candidates instead of picking one',
      () => tools.androidLaunchApp.execute({ name: 'example' }, makeExec('android_launch_app', {})),
      /installed packages match "example"/)
    await expectThrow(step, 'a fragment matching nothing says not to guess a package name',
      () => tools.androidLaunchApp.execute({ name: 'zzznope' }, makeExec('android_launch_app', {})),
      /do not guess a package name/)

    // 8 ── android_shutdown refuses a phone (and says what to do instead).
    await expectThrow(step, 'an unauthorized target names the on-device prompt',
      () => tools.androidShutdown.execute(
        { device: 'R58M1234ABC' }, makeExec('android_shutdown', {})),
      /is unauthorized — accept the USB debugging prompt/)
    await withEnv({ DSH_SMOKE_PHONE_ONLINE: '1' }, () => expectThrow(
      step,
      'shutdown refuses an ONLINE physical device (a phone is powered off from the phone)',
      () => tools.androidShutdown.execute({ device: 'R58M1234ABC' }, makeExec('android_shutdown', {})),
      /powers off EMULATORS only/,
    ))

    // 9 ── android_build_run rejects a non-Gradle path before spawning anything.
    await expectThrow(step, 'build_run names the Gradle root requirement for a non-project path',
      () => tools.androidBuildRun.execute(
        { projectPath: shim }, makeExec('android_build_run', {})),
      /not a Gradle project/)

    // 10 ── android_boot: the live-stream envelope the panel hydrates from.
    reset()
    const boot = await tools.androidBoot.execute(
      { device: 'emulator-5554' }, makeExec('android_boot', { device: 'emulator-5554' }))
    step('android_boot adopts an ONLINE serial without booting anything',
      boot.streaming === true && boot.booted === false && boot.device.serial === 'emulator-5554',
      `booted=${boot.booted}`)
    const bootMeta = tools.androidBoot.output.presentationMeta({ device: 'emulator-5554' }, boot)
    step('android_boot presentationMeta is a stable android-stream envelope',
      bootMeta.kind === 'android-stream'
      && bootMeta.streamRouteId === 'dsh-android/stream/emulator-5554'
      && bootMeta.device.serial === 'emulator-5554'
      && findJsonViolations(bootMeta).length === 0,
      bootMeta.streamRouteId)
    await expectThrow(step, 'boot on an unknown reference lists what IS available',
      () => tools.androidBoot.execute({ device: 'nope-1234' }, makeExec('android_boot', {})),
      /neither an online adb serial nor a known AVD name/)
    await host.stop()

    // 11 ── the ScreenshotStore never overwrites a live signed URL.
    const storeDir = mkdtempSync(join(tmpdir(), 'dsh-android-store-'))
    const store = new ScreenshotStore(storeDir)
    const first = store.nextPath('emulator-5554')
    writeFileSync(first, 'x')
    const second = new ScreenshotStore(storeDir).nextPath('emulator-5554')
    step('a second ScreenshotStore skips names already on disk (three writers share the directory)',
      second !== first && !existsSync(second) && /screenshot-[0-9a-f-]{36}\.png$/u.test(second),
      `${first} → ${second}`)
    rmSync(storeDir, { recursive: true, force: true })

    await host.dispose()
  })

  // 12 ── degradation: no adb at all still registers, and says why. An
  // explicit ADB override is used rather than an empty PATH, because the SDK
  // fallbacks would otherwise find this machine's REAL adb and the case would
  // silently stop being tested.
  await withEnv({ ADB: join(shim, 'no-such-adb'), ANDROID_HOME: shim, PATH: join(shim, 'empty') },
    async () => {
      const toolchain = new AdbToolchain()
      const host = new AndroidHostController(toolchain, { idleTimeoutMs: 0 })
      const tools = createAndroidTools(host, { cacheDir: join(shim, 'no-adb-tool-cache') })
      step('the tools still construct when adb is unresolvable',
        toolchain.available === false && typeof tools.androidDevices.execute === 'function',
        toolchain.binary.reason)
      await expectThrow(step, 'an adb-less host fails with an explanatory error, not a crash',
        () => tools.androidDevices.execute({}, makeExec('android_devices', {})),
        /adb is unavailable — .*(PATH|ADB)/)
      await host.dispose()
    })

  // 13 ── the Gradle pipeline's pure halves, on a synthetic project tree.
  // Nothing is built here; what is asserted is the part a failed build would
  // otherwise hide — which Gradle is chosen, and where the applicationId came
  // from (it is never guessed from the module name).
  const {
    applicationIdFromOutputMetadata,
    assembleGradleArgs,
    assembleTask,
    detectProject,
    filterBuildOutput,
    findBuiltApk,
    launchPackage,
    resolveApplicationId,
    runGradleBuild,
  } = buildRunLib
  // Keep a space in the root: wrapper quoting on Windows must work without
  // falling back to shell:true or a hand-built command string.
  const project = mkdtempSync(join(tmpdir(), 'dsh android gradle-'))
  writeFileSync(join(project, 'settings.gradle.kts'), 'rootProject.name = "smoke"\n')
  const apkDir = join(project, 'app', 'build', 'outputs', 'apk', 'debug')
  mkdirSync(apkDir, { recursive: true })
  writeFileSync(join(apkDir, 'app-debug.apk'), 'not really an apk')
  writeFileSync(join(apkDir, 'output-metadata.json'), JSON.stringify({
    version: 3, applicationId: 'dev.example.demo.debug', variantName: 'debug', elements: [],
  }))
  const detectedByPath = detectProject(join(project, 'app'))
  step('detectProject climbs from a module directory to the Gradle root',
    detectedByPath.root === project && detectedByPath.buildFile.endsWith('settings.gradle.kts'),
    detectedByPath.root)
  step('without a wrapper the PATH gradle is the fallback, and says which it is',
    detectedByPath.gradleSource === 'path' && detectedByPath.gradleCommand.startsWith('gradle'),
    detectedByPath.gradleCommand)
  const wrapper = join(project, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  const recordedArgs = join(project, 'gradle-args.txt')
  writeFileSync(wrapper, process.platform === 'win32'
    ? '@echo off\r\n> "%~dp0gradle-args.txt" echo %*\r\nexit /b 0\r\n'
    : '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$(dirname "$0")/gradle-args.txt"\nexit 0\n',
  { mode: 0o755 })
  if (process.platform !== 'win32') chmodSync(wrapper, 0o755)
  const detected = detectProject(project)
  step('the ./gradlew wrapper WINS over a PATH gradle (it pins the project\'s Gradle version)',
    detected.gradleSource === 'wrapper' && detected.gradleCommand === wrapper,
    detected.gradleCommand)
  step('assembleTask capitalizes the variant and scopes it to a module',
    assembleTask('debug') === 'assembleDebug'
    && assembleTask('debug', 'app') === ':app:assembleDebug'
    && assembleTask('release', ':app:') === ':app:assembleRelease',
    'assembleDebug / :app:assembleDebug')
  const gradleArgs = assembleGradleArgs(assembleTask('debug', 'app'))
  const gradleRun = await runGradleBuild(detected, gradleArgs, new AbortController().signal)
  const receivedArgs = readFileSync(recordedArgs, 'utf8').trim().split(/\s+/u)
  step('the wrapper receives an exact argv (gradlew.bat uses controlled cmd.exe on Windows)',
    gradleRun.exitCode === 0 && JSON.stringify(receivedArgs) === JSON.stringify(gradleArgs),
    `${detected.gradleCommand} ← ${receivedArgs.join(' ')}`)

  await expectThrow(step, 'a shell-bearing variant is rejected before it can become a task or output path',
    () => assembleTask('debug & whoami'), /unsafe variant/)
  await expectThrow(step, 'a shell-bearing module is rejected before it can become a Gradle project path',
    () => assembleTask('debug', 'app & whoami'), /unsafe module/)
  await expectThrow(step, 'a shell-bearing extra Gradle argument is rejected at argv construction',
    () => assembleGradleArgs('assembleDebug', ['--scan&whoami']), /unsafe Gradle argument/)
  rmSync(recordedArgs, { force: true })
  await expectThrow(step, 'runGradleBuild independently rejects unsafe argv before spawning the wrapper',
    () => runGradleBuild(detected, ['assembleDebug', '--console=plain&whoami'], new AbortController().signal),
    /unsafe Gradle argument/)
  step('an argv rejected by the final spawn gate never reaches gradlew', !existsSync(recordedArgs),
    'no gradle-args.txt side effect')
  await expectThrow(step, 'findBuiltApk rejects a variant that could escape its output directory',
    () => findBuiltApk(project, '../../release'), /unsafe variant/)

  if (process.platform === 'win32') {
    const descendantSource = join(project, 'gradle-child.mjs')
    const descendantPidFile = join(project, 'gradle-child.pid')
    writeFileSync(descendantSource, [
      "import { writeFileSync } from 'node:fs'",
      "writeFileSync(new URL('./gradle-child.pid', import.meta.url), String(process.pid))",
      'setInterval(() => undefined, 1000)',
      '',
    ].join('\n'))
    writeFileSync(wrapper, '@echo off\r\nnode "%~dp0gradle-child.mjs"\r\n')
    const controller = new AbortController()
    const pending = runGradleBuild(detected, assembleGradleArgs('assembleDebug'), controller.signal)
    const observed = pending.then(() => true, () => true)
    const pidDeadline = Date.now() + 5_000
    while (!existsSync(descendantPidFile) && Date.now() < pidDeadline) await delay(25)
    const descendantPid = existsSync(descendantPidFile)
      ? Number.parseInt(readFileSync(descendantPidFile, 'utf8'), 10)
      : undefined
    controller.abort(new Error('smoke cancellation (the execution timeout uses the same abort signal)'))
    const invocationSettled = await Promise.race([observed, delay(5_000).then(() => false)])
    const processExists = pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const stopDeadline = Date.now() + 3_000
    while (descendantPid !== undefined && processExists(descendantPid) && Date.now() < stopDeadline) {
      await delay(25)
    }
    const descendantStopped = descendantPid !== undefined && !processExists(descendantPid)
    if (descendantPid !== undefined && !descendantStopped) {
      try { process.kill(descendantPid, 'SIGKILL') } catch { /* already gone */ }
    }
    step('a cancellation/timeout abort kills the Windows gradlew descendant tree',
      invocationSettled && descendantStopped,
      `pid=${String(descendantPid)} settled=${String(invocationSettled)} stopped=${String(descendantStopped)}`)
  }
  const apk = findBuiltApk(project, 'debug')
  step('findBuiltApk locates build/outputs/apk/<variant>/*.apk below the root',
    apk?.path === join(apkDir, 'app-debug.apk') && apk.outputDir === apkDir, apk?.path)
  step('the applicationId comes from the metadata AGP wrote, suffix and all',
    applicationIdFromOutputMetadata(apkDir) === 'dev.example.demo.debug'
    && resolveApplicationId(apk, project).source === 'output-metadata',
    'dev.example.demo.debug')
  writeFileSync(join(apkDir, 'output-metadata.json'), JSON.stringify({
    version: 3, applicationId: 'dev.example.demo&whoami', variantName: 'debug', elements: [],
  }))
  await expectThrow(step, 'an unsafe applicationId in authoritative AGP metadata is rejected',
    () => applicationIdFromOutputMetadata(apkDir), /unsafe applicationId/)
  rmSync(join(apkDir, 'output-metadata.json'), { force: true })
  const moduleBuild = join(project, 'app', 'build.gradle.kts')
  writeFileSync(moduleBuild, 'android {\n  namespace = "dev.example.demo;whoami"\n}\n')
  await expectThrow(step, 'an unsafe applicationId in a module build script is rejected as a whole value',
    () => resolveApplicationId(findBuiltApk(project, 'debug'), project), /unsafe applicationId/)
  writeFileSync(moduleBuild, 'android {\n  namespace = "dev.example.demo"\n}\n')
  step('without metadata the module build script is the fallback source',
    (() => {
      const resolved = resolveApplicationId(findBuiltApk(project, 'debug'), project)
      return resolved.packageName === 'dev.example.demo' && resolved.source === 'build-script'
    })(), 'build-script')
  let unsafeLaunchReachedAdb = false
  await expectThrow(step, 'launchPackage validates a direct package argument before adb shell',
    () => launchPackage({
      shell: async () => {
        unsafeLaunchReachedAdb = true
        return ''
      },
    }, 'emulator-5554', 'dev.example.demo;whoami'), /unsafe applicationId/)
  step('an unsafe launch package never reaches adb shell', !unsafeLaunchReachedAdb, 'shell was not called')
  step('the build tail keeps compiler diagnostics and drops Gradle progress noise',
    (() => {
      const kept = filterBuildOutput([
        '> Task :app:compileDebugKotlin',
        '',
        'e: file:///x/Main.kt:12:3 Unresolved reference: nope',
        '5 actionable tasks: 5 executed',
        'BUILD SUCCESSFUL in 3s',
      ])
      return kept.length === 1 && kept[0].includes('Unresolved reference')
    })(), 'only the diagnostic survives')
  rmSync(project, { recursive: true, force: true })

  // 14 ── the debug parsers, against shapes recorded from a real Android 14
  // emulator. These are pure, so they are asserted here rather than needing a
  // device; the App Summary case caught a live bug (the block's own `------`
  // rule flipped the walk back into detail mode and every summary row was
  // silently dropped).
  const { capBacktrace, parseMeminfo, parsePackageInfo, parseProcessTable } = toolDebugLib
  const meminfo = parseMeminfo([
    'Applications Memory Usage (in Kilobytes):',
    '** MEMINFO in pid 753 [com.android.systemui] **',
    '                   Pss  Private  Private',
    '                ------   ------   ------',
    '  Native Heap    15407    13880     1504',
    '  Dalvik Heap    13036    12956       48',
    '        TOTAL    85007    36144    16656',
    ' ',
    ' App Summary',
    '                       Pss(KB)                        Rss(KB)',
    '                        ------                         ------',
    '           Java Heap:    14200                          31724',
    '         Native Heap:    13880                          16476',
    '                Code:    12248                          95320',
    ' ',
    '           TOTAL PSS:    85007            TOTAL RSS:   158140       TOTAL SWAP PSS:    24863',
    ' Objects',
    '               Views:     1025',
  ].join('\n'))
  step('parseMeminfo reads TOTAL PSS and the App Summary rows past its own `------` rule',
    meminfo?.totalPssKb === 85007 && meminfo.totalRssKb === 158140 && meminfo.totalSwapPssKb === 24863
    && meminfo.javaHeapKb === 14200 && meminfo.nativeHeapKb === 13880 && meminfo.codeKb === 12248
    && meminfo.pid === 753,
    JSON.stringify({ pss: meminfo?.totalPssKb, java: meminfo?.javaHeapKb, native: meminfo?.nativeHeapKb }))
  step('parseMeminfo ranks the detail categories and drops its TOTAL row',
    meminfo.topCategories[0].name === 'Native Heap' && meminfo.topCategories[0].pssKb === 15407
    && meminfo.topCategories.every(entry => entry.name !== 'TOTAL'),
    JSON.stringify(meminfo.topCategories))

  const packageDump = [
    'Packages:',
    '  Package [dev.example.demo] (a083c3f):',
    '    codePath=/data/app/~~rw==/dev.example.demo-Qx==',
    '    versionCode=1 minSdk=23 targetSdk=35',
    '    versionName=0.1',
    '    flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]',
    '    dataDir=/data/user/0/dev.example.demo',
    '    lastUpdateTime=2026-07-30 18:09:21',
    '      firstInstallTime=2026-07-30 17:45:50',
    '  Package [com.android.settings] (d4e5f6):',
    '    versionCode=34 minSdk=34 targetSdk=34',
    '    versionName=14',
    '    flags=[ SYSTEM HAS_CODE ]',
  ].join('\n')
  const demoFacts = parsePackageInfo(packageDump, 'dev.example.demo')
  step('parsePackageInfo stops at the next Package [ ] header',
    demoFacts?.version === '0.1' && demoFacts.versionCode === 1 && demoFacts.minSdk === 23
    && demoFacts.targetSdk === 35 && demoFacts.system === false
    && demoFacts.dataDir === '/data/user/0/dev.example.demo',
    JSON.stringify(demoFacts))
  step('parsePackageInfo reads the SYSTEM flag of the second block',
    parsePackageInfo(packageDump, 'com.android.settings')?.system === true, 'system:true')
  step('parsePackageInfo returns undefined for a package that is not installed',
    parsePackageInfo(packageDump, 'com.nope.nope') === undefined, 'not installed is a fact, not a throw')

  step('parseProcessTable skips the ps header and sorts by pid',
    (() => {
      const rows = parseProcessTable('  PID NAME\n  753 com.android.systemui\n    1 init\n')
      return rows.length === 2 && rows[0].pid === 1 && rows[1].name === 'com.android.systemui'
    })(), 'header dropped')
  await expectThrow(step, 'an unparseable ps dump throws instead of reporting no processes',
    async () => parseProcessTable('error: device offline\n'), /the listing FAILED/)
  step('capBacktrace keeps the HEAD of a stack (the innermost frames)',
    (() => {
      const capped = capBacktrace(Array.from({ length: 250 }, (_, index) => `frame ${index}`), 200)
      return capped.truncated === true && capped.lines.length === 200 && capped.lines[0] === 'frame 0'
    })(), 'head kept, unlike a log tail')

  finish()
}

try {
  await main()
} finally {
  rmSync(shim, { recursive: true, force: true })
}
