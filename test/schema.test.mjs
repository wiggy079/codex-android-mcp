import assert from 'node:assert/strict'
import test from 'node:test'
import { dshParametersToJsonSchema } from '../lib/mcp-schema.js'

test('converts the upstream property DSL into strict JSON Schema', () => {
  const schema = dshParametersToJsonSchema({
    packageName: { type: 'string', required: true },
    optional: { type: 'number' },
    json: { type: 'json' },
    nested: {
      type: 'object',
      properties: {
        value: { type: 'string', required: true },
      },
    },
  })

  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['packageName'])
  assert.deepEqual(schema.properties.json, {})
  assert.deepEqual(schema.properties.nested.required, ['value'])
  assert.equal(schema.properties.packageName.maxLength, 255)
  assert.match('com.example.app', new RegExp(schema.properties.packageName.pattern))
  assert.doesNotMatch('com.example;id', new RegExp(schema.properties.packageName.pattern))
})

