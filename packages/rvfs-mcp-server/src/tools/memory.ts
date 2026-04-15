import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db, now, type MemoryRow } from '../db.js'

export function registerMemoryTools(server: McpServer): void {
  // ── memory_set ─────────────────────────────────────────────────────────────
  server.tool(
    'memory_set',
    'Store or update a persistent memory entry for an agent. Survives server restarts. Good for decisions, conventions, and context an agent wants to remember across sessions.',
    {
      agent: z.string().describe('Your first name (e.g. Alex)'),
      key: z.string().describe('Short identifier for this memory, e.g. "arch-decision-session-ttl"'),
      value: z.string().describe('The content to remember — freeform text'),
    },
    async ({ agent, key, value }) => {
      db.prepare(
        'INSERT INTO memories (agent, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(agent, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).run(agent, key, value, now())
      return { content: [{ type: 'text', text: `Memory saved: ${agent}/${key}` }] }
    },
  )

  // ── memory_get ─────────────────────────────────────────────────────────────
  server.tool(
    'memory_get',
    'Retrieve a specific memory entry for an agent by key.',
    {
      agent: z.string().describe('Agent first name'),
      key: z.string().describe('Memory key to retrieve'),
    },
    async ({ agent, key }) => {
      const row = db
        .prepare<[string, string], MemoryRow>('SELECT * FROM memories WHERE agent = ? AND key = ?')
        .get(agent, key)
      if (!row) {
        return {
          content: [{ type: 'text', text: `No memory found for ${agent}/${key}` }],
          isError: true,
        }
      }
      return {
        content: [
          { type: 'text', text: `[${row.key}] (updated ${row.updated_at})\n\n${row.value}` },
        ],
      }
    },
  )

  // ── memory_list ────────────────────────────────────────────────────────────
  server.tool(
    'memory_list',
    "List all memory keys stored for an agent, with a short preview of each value.",
    {
      agent: z.string().describe('Agent first name'),
    },
    async ({ agent }) => {
      const rows = db
        .prepare<[string], MemoryRow>('SELECT * FROM memories WHERE agent = ? ORDER BY key')
        .all(agent)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No memories stored for ${agent}.` }] }
      }
      const lines = rows.map((r) => {
        const preview = r.value.length > 80 ? r.value.slice(0, 80) + '…' : r.value
        return `• ${r.key}: ${preview}`
      })
      return {
        content: [{ type: 'text', text: `Memories for ${agent} (${rows.length}):\n\n${lines.join('\n')}` }],
      }
    },
  )

  // ── memory_delete ──────────────────────────────────────────────────────────
  server.tool(
    'memory_delete',
    'Delete a specific memory entry for an agent.',
    {
      agent: z.string().describe('Agent first name'),
      key: z.string().describe('Memory key to delete'),
    },
    async ({ agent, key }) => {
      const result = db
        .prepare('DELETE FROM memories WHERE agent = ? AND key = ?')
        .run(agent, key)
      if (result.changes === 0) {
        return {
          content: [{ type: 'text', text: `No memory found for ${agent}/${key}` }],
          isError: true,
        }
      }
      return { content: [{ type: 'text', text: `Deleted memory ${agent}/${key}` }] }
    },
  )
}
