/**
 * Small compatibility seam for the upstream dsh-android tool factories.
 *
 * The upstream implementation describes tools with a JSON-schema-like DSL.
 * Keeping that shape lets this project reuse the tested adb handlers while
 * the MCP adapter in server.ts performs standards-compliant registration and
 * validation through the official SDK.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ToolExecutionContext extends VisionExecLike {
  signal: AbortSignal
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  timeoutMs?: number
  isConcurrencySafe?: (args: unknown) => boolean
  execute: (args: any, context: ToolExecutionContext) => unknown | Promise<unknown>
  [key: string]: unknown
}

/** Argument error compatible with the upstream tool factories and smoke tests. */
export class ToolArgsError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(issues.join('\n'))
    this.name = 'ToolArgsError'
    this.issues = [...issues]
  }
}

export function defineTool<T extends ToolDefinition>(definition: T): T {
  return definition
}
import type { VisionExecLike } from './vision.js'
