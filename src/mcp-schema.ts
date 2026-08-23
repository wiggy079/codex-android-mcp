import type { ToolDefinition } from './mcp-tool.js'

export type JsonSchema = Record<string, unknown>

const ALLOWED_SCHEMA_KEYS = new Set([
  '$id', '$ref', '$schema', 'additionalProperties', 'allOf', 'anyOf', 'const',
  'default', 'description', 'enum', 'examples', 'exclusiveMaximum',
  'exclusiveMinimum', 'format', 'items', 'maxItems', 'maxLength', 'maximum',
  'maxProperties', 'minItems', 'minLength', 'minimum', 'minProperties',
  'multipleOf', 'not', 'oneOf', 'pattern', 'properties', 'propertyNames',
  'title', 'type', 'uniqueItems',
])

function convertNode(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(convertNode)
  if (input === null || typeof input !== 'object') return input

  const source = input as Record<string, unknown>
  const output: JsonSchema = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'required') continue
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue
    if (key === 'properties' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const properties: JsonSchema = {}
      const required: string[] = []
      for (const [propertyName, propertySchema] of Object.entries(value as Record<string, unknown>)) {
        properties[propertyName] = convertNode(propertySchema)
        if (
          propertySchema !== null
          && typeof propertySchema === 'object'
          && !Array.isArray(propertySchema)
          && (propertySchema as Record<string, unknown>).required === true
        ) required.push(propertyName)
      }
      output.properties = properties
      if (required.length > 0) output.required = required
      continue
    }
    // The upstream DSL uses `type: "json"` for an arbitrary JSON value.
    // JSON Schema expresses that by omitting `type` entirely.
    if (key === 'type' && value === 'json') continue
    output[key] = convertNode(value)
  }
  return output
}

/** Convert the upstream property-map DSL into strict draft-2020 JSON Schema. */
export function dshParametersToJsonSchema(parameters: ToolDefinition['parameters']): JsonSchema {
  const properties: JsonSchema = {}
  const required: string[] = []
  for (const [name, schema] of Object.entries(parameters)) {
    const converted = convertNode(schema) as JsonSchema
    // Defense in depth: advertise the same limits the runtime policy applies.
    if (['packageName', 'package_name', 'bundle_id'].includes(name)) {
      converted.pattern = '^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$'
      converted.maxLength = 255
    } else if (name === 'device' || name === 'serial') {
      converted.maxLength = 128
    } else if (name === 'text') {
      converted.maxLength = 4096
    } else if (name === 'grep') {
      converted.maxLength = 256
    }
    properties[name] = converted
    if (
      schema !== null
      && typeof schema === 'object'
      && !Array.isArray(schema)
      && (schema as Record<string, unknown>).required === true
    ) required.push(name)
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  }
}
