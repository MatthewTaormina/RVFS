import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerJsonTools(server: McpServer): void {
  // ── validate_json ─────────────────────────────────────────────────────────
  server.tool(
    'validate_json',
    'Parse and validate a JSON string. Returns a pretty-printed version on success, or a detailed parse error with context on failure. Useful for verifying API response payloads.',
    {
      json_string: z.string().describe('The JSON string to validate and pretty-print'),
      check_fields: z
        .array(z.string())
        .optional()
        .describe('Optional list of dot-notated field paths that must exist in the JSON, e.g. ["data.id", "meta.ttl"]'),
    },
    async ({ json_string, check_fields }) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(json_string)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Provide some context around the error position
        const match = message.match(/position (\d+)/)
        let context = ''
        if (match) {
          const pos = parseInt(match[1], 10)
          const start = Math.max(0, pos - 30)
          const end = Math.min(json_string.length, pos + 30)
          context = `\n\nContext near error:\n  ...${json_string.slice(start, end)}...\n  ${' '.repeat(pos - start + 3)}^ here`
        }
        return {
          content: [{ type: 'text', text: `❌ Invalid JSON\n\nError: ${message}${context}` }],
          isError: true,
        }
      }

      const lines: string[] = ['✅ Valid JSON', '', JSON.stringify(parsed, null, 2)]

      if (check_fields && check_fields.length > 0) {
        lines.push('', '── Field Checks ─────────────────────────')
        for (const fieldPath of check_fields) {
          const value = getNestedField(parsed, fieldPath)
          const exists = value !== undefined
          lines.push(`  ${exists ? '✓' : '✗'} ${fieldPath}: ${exists ? JSON.stringify(value) : 'MISSING'}`)
        }
        const allPresent = check_fields.every((f) => getNestedField(parsed, f) !== undefined)
        if (!allPresent) {
          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            isError: true,
          }
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  )
}

function getNestedField(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}
