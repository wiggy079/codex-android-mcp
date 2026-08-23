import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AndroidDevice } from './adb.js'
import type { AndroidHostController } from './android-host.js'

export const ANDROID_PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u
export const SAFE_DEVICE_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u
export const SAFE_AVD_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u
const LOCAL_EMULATOR_SERIAL_PATTERN = /^emulator-\d+$/u

const TARGET_ARGUMENT = new Map<string, 'device' | 'serial'>([
  ['android_shutdown', 'device'],
  ['android_screenshot', 'device'],
  ['android_interact', 'device'],
  ['android_list_apps', 'device'],
  ['android_launch_app', 'device'],
  ['android_build_run', 'device'],
  ['android_logs', 'device'],
  ['android_processes', 'device'],
  ['android_backtrace', 'device'],
  ['android_meminfo', 'device'],
  ['android_app_info', 'device'],
  ['android_ui_tree', 'serial'],
  ['android_tap_element', 'serial'],
  ['android_ui_rows', 'serial'],
  ['android_tap_row', 'serial'],
  ['android_find_text', 'serial'],
  ['android_wait_for', 'serial'],
  ['android_tap_text', 'serial'],
])

export interface AndroidMcpPolicy {
  allowPhysical: boolean
  allowBuildRun: boolean
  allowedSerials: ReadonlySet<string>
  allowedAvds: ReadonlySet<string>
  allowedPackages: ReadonlySet<string>
  allowedProjectRoots: readonly string[]
  cacheDir: string
  maxImageBytes: number
  maxTextBytes: number
}

function parseBoolean(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? '')
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function commaSet(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? '').split(',').map(item => item.trim()).filter(item => item !== ''))
}

function canonicalExistingDirectory(path: string): string {
  const canonical = realpathSync(resolve(path))
  if (!statSync(canonical).isDirectory()) throw new Error(`${canonical} is not a directory`)
  return canonical
}

export function loadPolicy(env: NodeJS.ProcessEnv = process.env): AndroidMcpPolicy {
  const roots = (env.ANDROID_MCP_ALLOWED_PROJECT_ROOTS ?? '')
    .split(delimiter)
    .map(item => item.trim())
    .filter(item => item !== '')
    .map(canonicalExistingDirectory)
  return {
    allowPhysical: parseBoolean(env.ANDROID_MCP_ALLOW_PHYSICAL),
    allowBuildRun: parseBoolean(env.ANDROID_MCP_ALLOW_BUILD_RUN),
    allowedSerials: commaSet(env.ANDROID_MCP_ALLOWED_SERIALS),
    allowedAvds: commaSet(env.ANDROID_MCP_ALLOWED_AVDS),
    allowedPackages: commaSet(env.ANDROID_MCP_ALLOWED_PACKAGES),
    allowedProjectRoots: roots,
    cacheDir: resolve(env.ANDROID_MCP_CACHE_DIR?.trim() || join(tmpdir(), 'codex-android-mcp')),
    maxImageBytes: positiveInteger(env.ANDROID_MCP_MAX_IMAGE_BYTES, 8 * 1024 * 1024),
    maxTextBytes: positiveInteger(env.ANDROID_MCP_MAX_TEXT_BYTES, 4096),
  }
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  const normalized = process.platform === 'win32' ? pathFromRoot.toLowerCase() : pathFromRoot
  return normalized === '' || (!normalized.startsWith(`..${sep}`) && normalized !== '..' && !isAbsolute(normalized))
}

function assertRegularFileInside(root: string, path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`android_build_run requires ${label} in projectPath`)
  const direct = lstatSync(path)
  if (direct.isSymbolicLink() || !direct.isFile()) {
    throw new Error(`android_build_run requires ${label} to be a regular, non-symlink file`)
  }
  const canonical = realpathSync(path)
  if (!isInside(root, canonical)) throw new Error(`android_build_run ${label} resolves outside projectPath`)
  return canonical
}

function assertTrustedGradleRoot(candidate: string): void {
  const settings = ['settings.gradle', 'settings.gradle.kts']
    .map(name => join(candidate, name))
    .find(existsSync)
  if (settings === undefined) {
    throw new Error('android_build_run projectPath must directly name a Gradle root containing settings.gradle or settings.gradle.kts')
  }
  assertRegularFileInside(candidate, settings, 'the Gradle settings file')
  const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const wrapper = assertRegularFileInside(candidate, join(candidate, wrapperName), wrapperName)
  if (process.platform !== 'win32' && (statSync(wrapper).mode & 0o111) === 0) {
    throw new Error('android_build_run requires gradlew to be executable')
  }
}

function authorizeProjectPath(path: unknown, policy: AndroidMcpPolicy): string {
  if (!policy.allowBuildRun) {
    throw new Error('android_build_run is disabled by default; set ANDROID_MCP_ALLOW_BUILD_RUN=true and configure ANDROID_MCP_ALLOWED_PROJECT_ROOTS to opt in')
  }
  if (policy.allowedProjectRoots.length === 0) {
    throw new Error('android_build_run remains blocked because ANDROID_MCP_ALLOWED_PROJECT_ROOTS is empty')
  }
  if (typeof path !== 'string' || path.trim() === '') throw new Error('android_build_run requires projectPath')
  let candidate: string
  try {
    candidate = canonicalExistingDirectory(path)
  } catch (error) {
    throw new Error(`android_build_run projectPath cannot be resolved: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!policy.allowedProjectRoots.some(root => isInside(root, candidate))) {
    throw new Error('android_build_run projectPath is outside ANDROID_MCP_ALLOWED_PROJECT_ROOTS')
  }
  assertTrustedGradleRoot(candidate)
  return candidate
}

export function assertSafePackageName(value: string, label = 'package name'): string {
  const packageName = value.trim()
  if (packageName.length > 255 || !ANDROID_PACKAGE_PATTERN.test(packageName)) {
    throw new Error(`${label} must be a dotted Android package such as "com.example.app"`)
  }
  return packageName
}

function authorizePackages(tool: string, args: Record<string, unknown>, policy: AndroidMcpPolicy): void {
  for (const key of ['packageName', 'package_name', 'bundle_id']) {
    const value = args[key]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string') throw new Error(`${tool}: ${key} must be a string`)
    const packageName = assertSafePackageName(value, `${tool}: ${key}`)
    args[key] = packageName
    if (policy.allowedPackages.size > 0 && !policy.allowedPackages.has(packageName)) {
      throw new Error(`${tool}: ${packageName} is not listed in ANDROID_MCP_ALLOWED_PACKAGES`)
    }
  }
  if (policy.allowedPackages.size > 0 && tool === 'android_launch_app' && args.name !== undefined) {
    throw new Error('android_launch_app: name-based lookup is disabled when ANDROID_MCP_ALLOWED_PACKAGES is set; pass an exact packageName')
  }
  if (policy.allowedPackages.size > 0 && tool === 'android_backtrace' && args.pid !== undefined && args.package_name === undefined) {
    throw new Error('android_backtrace: pid-only access is disabled when ANDROID_MCP_ALLOWED_PACKAGES is set; also pass an allowed package_name')
  }
}

function isLocalEmulator(device: AndroidDevice): boolean {
  return device.emulator && LOCAL_EMULATOR_SERIAL_PATTERN.test(device.serial)
}

function serialAllowed(device: AndroidDevice, policy: AndroidMcpPolicy): boolean {
  if (policy.allowedSerials.size > 0 && !policy.allowedSerials.has(device.serial)) return false
  if (isLocalEmulator(device)) return true
  return policy.allowPhysical && policy.allowedSerials.has(device.serial)
}

function assertDeviceAllowed(device: AndroidDevice, explicitlySelected: boolean, policy: AndroidMcpPolicy): void {
  const localEmulator = isLocalEmulator(device)
  if (!localEmulator && !explicitlySelected) {
    throw new Error('physical Android devices are never selected implicitly; pass the exact serial on every call')
  }
  if (!serialAllowed(device, policy)) {
    if (!localEmulator) {
      throw new Error('physical device access is disabled; set ANDROID_MCP_ALLOW_PHYSICAL=true and add this exact serial to ANDROID_MCP_ALLOWED_SERIALS')
    }
    throw new Error(`emulator ${device.serial} is not listed in ANDROID_MCP_ALLOWED_SERIALS`)
  }
}

async function authorizeTarget(
  tool: string,
  args: Record<string, unknown>,
  key: 'device' | 'serial',
  host: AndroidHostController,
  policy: AndroidMcpPolicy,
): Promise<void> {
  const raw = args[key]
  const requested = typeof raw === 'string' ? raw.trim() : ''
  if (raw !== undefined && typeof raw !== 'string') throw new Error(`${tool}: ${key} must be a string`)
  const listed = await host.toolchain.listDevices()
  if (requested !== '') {
    if (!SAFE_DEVICE_REFERENCE_PATTERN.test(requested)) throw new Error(`${tool}: ${key} has an unsafe or unsupported format`)
    const device = listed.find(item => item.serial === requested)
    if (device === undefined) throw new Error(`${tool}: no connected Android device has serial ${requested}`)
    if (device.state !== 'device') throw new Error(`${tool}: the selected Android target is not online and ready`)
    assertDeviceAllowed(device, true, policy)
    if (tool === 'android_shutdown' && !isLocalEmulator(device)) {
      throw new Error('android_shutdown only accepts a local emulator-<port> target')
    }
    args[key] = requested
    return
  }
  const eligibleEmulators = listed.filter(device => device.state === 'device' && isLocalEmulator(device) && serialAllowed(device, policy))
  if (eligibleEmulators.length !== 1) {
    throw new Error(
      eligibleEmulators.length === 0
        ? `${tool}: no allowed online emulator is available; physical devices require an exact serial on every call`
        : `${tool}: ${eligibleEmulators.length} allowed emulators are online; pass an exact serial`,
    )
  }
  args[key] = eligibleEmulators[0]!.serial
}

async function authorizeBoot(
  args: Record<string, unknown>,
  host: AndroidHostController,
  policy: AndroidMcpPolicy,
): Promise<void> {
  const raw = args.device
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('android_boot: device is required')
  const reference = raw.trim()
  const listed = await host.toolchain.listDevices()
  const connected = listed.find(device => device.serial === reference)
  if (connected !== undefined) {
    if (!SAFE_DEVICE_REFERENCE_PATTERN.test(reference)) throw new Error('android_boot: device serial has an unsafe format')
    if (connected.state !== 'device') throw new Error('android_boot: the selected Android target is not online and ready')
    assertDeviceAllowed(connected, true, policy)
  } else {
    if (!SAFE_AVD_PATTERN.test(reference)) throw new Error('android_boot: AVD names may contain only letters, numbers, dot, underscore, and hyphen')
    if (policy.allowedAvds.size > 0 && !policy.allowedAvds.has(reference)) {
      throw new Error(`android_boot: AVD ${reference} is not listed in ANDROID_MCP_ALLOWED_AVDS`)
    }
  }
  args.device = reference
}

/** Validate and normalize a tool call before any device or host mutation. */
export async function authorizeToolCall(
  tool: string,
  input: unknown,
  host: AndroidHostController,
  policy: AndroidMcpPolicy,
): Promise<Record<string, unknown>> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${tool}: arguments must be an object`)
  const args = { ...(input as Record<string, unknown>) }
  authorizePackages(tool, args, policy)
  if (tool === 'android_interact' && typeof args.text === 'string' && Buffer.byteLength(args.text, 'utf8') > policy.maxTextBytes) {
    throw new Error(`android_interact: text exceeds the ${policy.maxTextBytes}-byte policy limit`)
  }
  if (tool === 'android_build_run') args.projectPath = authorizeProjectPath(args.projectPath, policy)
  if (tool === 'android_devices') return args
  if (tool === 'android_boot') await authorizeBoot(args, host, policy)
  else {
    const key = TARGET_ARGUMENT.get(tool)
    if (key !== undefined) await authorizeTarget(tool, args, key, host, policy)
  }
  return args
}

/** Hide devices the server would refuse to operate on. */
export function filterDeviceListing(value: unknown, policy: AndroidMcpPolicy): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const result = { ...(value as Record<string, unknown>) }
  if (!Array.isArray(result.devices)) return result
  const devices = result.devices.flatMap(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const serial = typeof row.serial === 'string' ? row.serial : ''
    const device = { serial, emulator: row.kind === 'emulator', state: 'unknown' as const }
    if (serial === '' || !serialAllowed(device, policy)) return []
    return [{ ...row, kind: isLocalEmulator(device) ? 'emulator' : 'physical' }]
  })
  result.devices = devices
  result.count = devices.length
  result.online = devices
    .filter(item => (item as Record<string, unknown>).state === 'device')
    .map(item => (item as Record<string, unknown>).serial)
  if (Array.isArray(result.avds) && policy.allowedAvds.size > 0) {
    result.avds = result.avds.filter(name => typeof name === 'string' && policy.allowedAvds.has(name))
  }
  return result
}

export function sanitizeToolError(error: unknown, args: Record<string, unknown>): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const key of ['text', 'device', 'serial', 'projectPath']) {
    const secret = args[key]
    if (typeof secret !== 'string' || secret === '') continue
    const variants = key === 'text'
      ? [secret, secret.replace(/ /gu, '%s'), Buffer.from(secret, 'utf8').toString('base64')]
      : [secret]
    for (const variant of variants) message = message.split(variant).join('[REDACTED]')
  }
  return message.replace(/^dsh-android:\s*/u, 'codex-android-mcp: ')
}
