import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db, now, type ScratchpadRow } from '../db.js'

export function registerScratchpadTools(server: McpServer): void {
  // ── scratchpad_write ───────────────────────────────────────────────────────
  server.tool(
    'scratchpad_write',
    'Write (replace) an agent\'s scratchpad with new content. Use for active working notes, plans, or intermediate results during a task. Not persistent across unrelated sessions — use memory_set for anything that should survive.',
    {
      agent: z.string().describe('Your first name (e.g. Alex)'),
      content: z.string().describe('New scratchpad content — replaces any existing content'),
    },
    async ({ agent, content }) => {
      db.prepare(
        'INSERT INTO scratchpads (agent, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      ).run(agent, content, now())
      return { content: [{ type: 'text', text: `Scratchpad written for ${agent}.` }] }
    },
  )

  // ── scratchpad_append ──────────────────────────────────────────────────────
  server.tool(
    'scratchpad_append',
    "Append text to an agent's scratchpad without overwriting existing content.",
    {
      agent: z.string().describe('Your first name'),
      text: z.string().describe('Text to append (a newline is automatically added before it)'),
    },
    async ({ agent, text }) => {
      const existing = db
        .prepare<[string], ScratchpadRow>('SELECT content FROM scratchpads WHERE agent = ?')
        .get(agent)
      const newContent = existing ? `${existing.content}\n${text}` : text
      db.prepare(
        'INSERT INTO scratchpads (agent, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      ).run(agent, newContent, now())
      return { content: [{ type: 'text', text: `Appended to ${agent}'s scratchpad.` }] }
    },
  )

  // ── scratchpad_read ────────────────────────────────────────────────────────
  server.tool(
    'scratchpad_read',
    "Read an agent's current scratchpad content.",
    {
      agent: z.string().describe('Agent first name'),
    },
    async ({ agent }) => {
      const row = db
        .prepare<[string], ScratchpadRow>('SELECT * FROM scratchpads WHERE agent = ?')
        .get(agent)
      if (!row || !row.content) {
        return { content: [{ type: 'text', text: `Scratchpad for ${agent} is empty.` }] }
      }
      return {
        content: [
          {
            type: 'text',
            text: `Scratchpad for ${agent} (updated ${row.updated_at}):\n\n${row.content}`,
          },
        ],
      }
    },
  )

  // ── scratchpad_clear ───────────────────────────────────────────────────────
  server.tool(
    'scratchpad_clear',
    "Clear an agent's scratchpad.",
    {
      agent: z.string().describe('Agent first name'),
    },
    async ({ agent }) => {
      db.prepare(
        'INSERT INTO scratchpads (agent, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET content = \'\', updated_at = excluded.updated_at',
      ).run(agent, '', now())
      return { content: [{ type: 'text', text: `Scratchpad cleared for ${agent}.` }] }
    },
  )
}
