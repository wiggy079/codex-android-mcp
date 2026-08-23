import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { AndroidHostController } from '../lib/android-host.js'
import { createAndroidMcpServer, takeImageFromResult } from '../lib/server.js'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function withScreenshotResult(png, check) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'codex-android-image-'))
  const device = {
    serial: 'emulator-5554',
    state: 'device',
    emulator: true,
    model: 'Fixture Emulator',
  }
  const toolchain = {
    available: true,
    binary: { available: true, source: 'env', command: 'fixture-adb' },
    listDevices: async () => [device],
    onlineDevices: async () => [device],
    deviceDetails: async () => ({
      serial: device.serial,
      model: device.model,
      androidVersion: '16',
      sdk: 36,
    }),
    execOut: async () => Buffer.from(png),
  }
  const host = new AndroidHostController(toolchain)
  const instance = createAndroidMcpServer({
    host,
    policy: {
      allowPhysical: false,
      allowBuildRun: false,
      allowedSerials: new Set(),
      allowedAvds: new Set(),
      allowedPackages: new Set(),
      allowedProjectRoots: [],
      cacheDir,
      maxImageBytes: 1024 * 1024,
      maxTextBytes: 4096,
    },
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'image-test', version: '1.0.0' })
  try {
    await Promise.all([instance.server.connect(serverTransport), client.connect(clientTransport)])
    const result = await client.callTool({
      name: 'android_screenshot',
      arguments: { device: device.serial },
    })
    await check(result, cacheDir)
  } finally {
    await client.close().catch(() => {})
    await instance.dispose()
    rmSync(cacheDir, { recursive: true, force: true })
  }
}

test('screenshot returns MCP ImageContent and erases its private cache file', async () => {
  await withScreenshotResult(TINY_PNG, (result, cacheDir) => {
    assert.equal(result.isError, undefined)
    const image = result.content.find(block => block.type === 'image')
    assert.ok(image)
    assert.equal(image.mimeType, 'image/png')
    assert.deepEqual(Buffer.from(image.data, 'base64'), TINY_PNG)
    assert.equal('path' in result.structuredContent, false)
    const screenshotDir = join(cacheDir, 'screenshots')
    assert.equal(existsSync(screenshotDir), true)
    assert.deepEqual(readdirSync(screenshotDir), [])
  })
})

test('screenshot rejects a PNG dimension bomb and still erases the cache file', async () => {
  const dimensionBomb = Buffer.from(TINY_PNG)
  dimensionBomb.writeUInt32BE(100_000, 16)
  dimensionBomb.writeUInt32BE(100_000, 20)
  await withScreenshotResult(dimensionBomb, (result, cacheDir) => {
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /dimensions exceed/u)
    assert.deepEqual(readdirSync(join(cacheDir, 'screenshots')), [])
  })
})

test('rejecting a screenshot path outside the private cache never deletes it', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'codex-android-image-boundary-'))
  const screenshotRoot = join(sandbox, 'cache', 'screenshots')
  const outside = join(sandbox, 'outside.png')
  mkdirSync(screenshotRoot, { recursive: true })
  writeFileSync(outside, TINY_PNG)
  try {
    assert.throws(
      () => takeImageFromResult({ path: outside }, screenshotRoot, 1024 * 1024),
      /outside the private cache/u,
    )
    assert.equal(existsSync(outside), true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
