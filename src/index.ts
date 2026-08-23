#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAndroidMcpServer } from './server.js'

const handle = serveStdio(() => createAndroidMcpServer().server, {
  onerror: error => console.error(`[codex-android-mcp] ${error.message}`),
})

let closing = false
const close = (): void => {
  if (closing) return
  closing = true
  void handle.close().catch(error => {
    console.error(`[codex-android-mcp] shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
console.error('[codex-android-mcp] serving MCP over stdio')
