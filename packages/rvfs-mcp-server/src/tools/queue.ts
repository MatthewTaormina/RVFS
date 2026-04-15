import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db, now, type MessageRow } from '../db.js'

export function registerQueueTools(server: McpServer): void {
  // ── message_send ───────────────────────────────────────────────────────────
  server.tool(
    'message_send',
    'Send a message from one agent to another. Use to hand off work, report blockers, request decisions, or notify the PM that a task is ready for review.',
    {
      from_agent: z.string().describe('Your first name (sender)'),
      to_agent: z.string().describe('Recipient first name — use "Morgan" for PM'),
      subject: z.string().describe('Short subject line, e.g. "T-003 ready for review"'),
      body: z.string().describe('Message body — include any context, links, or spec refs relevant to the recipient'),
    },
    async ({ from_agent, to_agent, subject, body }) => {
      const result = db
        .prepare(
          'INSERT INTO messages (from_agent, to_agent, subject, body, read, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        )
        .run(from_agent, to_agent, subject, body, now())
      return {
        content: [
          {
            type: 'text',
            text: `Message #${result.lastInsertRowid} sent to ${to_agent}: "${subject}"`,
          },
        ],
      }
    },
  )

  // ── message_inbox ──────────────────────────────────────────────────────────
  server.tool(
    'message_inbox',
    "Check an agent's inbox for unread messages. Returns all unread messages; call message_mark_read after processing each one.",
    {
      agent: z.string().describe('Your first name — fetch messages addressed to you'),
    },
    async ({ agent }) => {
      const rows = db
        .prepare<[string], MessageRow>(
          'SELECT * FROM messages WHERE to_agent = ? AND read = 0 ORDER BY id',
        )
        .all(agent)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No unread messages for ${agent}.` }] }
      }
      const formatted = rows
        .map(
          (m) =>
            `── Message #${m.id} ─────────────────────────\nFrom:    ${m.from_agent}\nSubject: ${m.subject}\nAt:      ${m.created_at}\n\n${m.body}\n`,
        )
        .join('\n')
      return {
        content: [
          {
            type: 'text',
            text: `${rows.length} unread message(s) for ${agent}:\n\n${formatted}`,
          },
        ],
      }
    },
  )

  // ── message_mark_read ──────────────────────────────────────────────────────
  server.tool(
    'message_mark_read',
    'Mark one or more messages as read after you have processed them.',
    {
      ids: z
        .array(z.number().int())
        .describe('Array of message IDs to mark as read, e.g. [1, 2, 3]'),
    },
    async ({ ids }) => {
      if (ids.length === 0) return { content: [{ type: 'text', text: 'No IDs provided.' }] }
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...ids)
      return { content: [{ type: 'text', text: `Marked ${ids.length} message(s) as read.` }] }
    },
  )

  // ── message_list ───────────────────────────────────────────────────────────
  server.tool(
    'message_list',
    "List messages (read and unread) for an agent, newest first. Useful for reviewing conversation history.",
    {
      agent: z.string().describe('Agent first name — fetch messages addressed to this person'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe('Maximum number of messages to return (default 20)'),
      unread_only: z
        .boolean()
        .default(false)
        .describe('If true, return only unread messages'),
    },
    async ({ agent, limit, unread_only }) => {
      const readFilter = unread_only ? ' AND read = 0' : ''
      const rows = db
        .prepare<[string, number], MessageRow>(
          `SELECT * FROM messages WHERE to_agent = ?${readFilter} ORDER BY id DESC LIMIT ?`,
        )
        .all(agent, limit)
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No messages found for ${agent}.` }] }
      }
      const lines = rows.map(
        (m) =>
          `#${m.id} [${m.read ? 'read' : 'UNREAD'}] from ${m.from_agent} — ${m.subject} (${m.created_at})`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `Messages for ${agent}:\n\n${lines.join('\n')}`,
          },
        ],
      }
    },
  )
}
