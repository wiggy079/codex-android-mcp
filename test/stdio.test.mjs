import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const ALL_TOOLS = [
  'android_devices', 'android_boot', 'android_shutdown', 'android_screenshot', 'android_interact',
  'android_list_apps', 'android_launch_app', 'android_build_run', 'android_ui_tree',
  'android_tap_element', 'android_ui_rows', 'android_tap_row', 'android_find_text',
  'android_wait_for', 'android_tap_text', 'android_logs', 'android_processes',
  'android_backtrace', 'android_meminfo', 'android_app_info',
]

const READ_ONLY = new Set([
  'android_devices', 'android_screenshot', 'android_list_apps', 'android_ui_tree',
  'android_ui_rows', 'android_find_text', 'android_wait_for', 'android_logs',
  'android_processes', 'android_meminfo', 'android_app_info',
])

const DESTRUCTIVE = new Set([
  'android_shutdown', 'android_interact', 'android_launch_app', 'android_build_run',
  'android_tap_element', 'android_tap_row', 'android_tap_text', 'android_backtrace',
])

function cleanEnv(enableBuild) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'))
  return {
    ...env,
    ANDROID_MCP_ALLOW_PHYSICAL: 'false',
    ANDROID_MCP_ALLOWED_SERIALS: '',
    ANDROID_MCP_ALLOWED_AVDS: '',
    ANDROID_MCP_ALLOWED_PACKAGES: '',
    ANDROID_MCP_ALLOW_BUILD_RUN: enableBuild ? 'true' : 'false',
    ANDROID_MCP_ALLOWED_PROJECT_ROOTS: enableBuild ? process.cwd() : '',
  }
}

async function inspectStdio(mode, enableBuild) {
  const stderr = []
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('lib/index.js')],
    cwd: process.cwd(),
    env: cleanEnv(enableBuild),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', chunk => stderr.push(chunk.toString('utf8')))
  const client = new Client(
    { name: `stdio-${mode}-test`, version: '1.0.0' },
    { versionNegotiation: { mode, probe: { timeoutMs: 5_000 } } },
  )
  try {
    await client.connect(transport)
    assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy')
    const instructions = client.getInstructions()
    assert.match(instructions, /untrusted data/u)
    assert.ok(instructions.indexOf('Physical devices') < 512)
    const { tools } = await client.listTools()
    const expected = enableBuild ? ALL_TOOLS : ALL_TOOLS.filter(name => name !== 'android_build_run')
    assert.equal(tools.length, expected.length)
    assert.deepEqual(tools.map(tool => tool.name), expected)
    assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length)
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object', tool.name)
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name)
      assert.equal(tool.annotations.readOnlyHint, READ_ONLY.has(tool.name), tool.name)
      assert.equal(tool.annotations.destructiveHint, DESTRUCTIVE.has(tool.name), tool.name)
      assert.equal(tool.annotations.idempotentHint, READ_ONLY.has(tool.name), tool.name)
      assert.equal(tool.annotations.openWorldHint, true, tool.name)
    }
    assert.match(stderr.join(''), /serving MCP over stdio/u)
  } finally {
    await client.close().catch(() => {})
  }
}

test('STDIO serves the legacy protocol with the safe 19-tool profile', async () => {
  await inspectStdio('legacy', false)
})

test('STDIO negotiates modern MCP and exposes 20 tools only with build opt-in', async () => {
  await inspectStdio('auto', true)
})

