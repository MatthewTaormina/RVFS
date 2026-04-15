import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db, now, type TaskRow } from '../db.js'

const STATUSES = ['todo', 'in-progress', 'blocked', 'review', 'done'] as const
type Status = (typeof STATUSES)[number]

function nextId(): string {
  const row = db.prepare<[], TaskRow>('SELECT id FROM tasks ORDER BY id DESC LIMIT 1').get()
  if (!row) return 'T-001'
  const num = parseInt(row.id.replace('T-', ''), 10)
  return `T-${String(num + 1).padStart(3, '0')}`
}

function formatTable(tasks: TaskRow[]): string {
  const rows = tasks.map(
    (t) =>
      `| ${t.id} | ${t.status} | ${t.agent} | ${t.prereqs || '-'} | ${t.refs || '-'} | ${t.description} |`,
  )
  return [
    '| ID | Status | Agent | Prereqs | References | Description |',
    '|----|--------|-------|---------|------------|-------------|',
    ...rows,
  ].join('\n')
}

export function registerWbsTools(server: McpServer): void {
  // ── wbs_list ───────────────────────────────────────────────────────────────
  server.tool(
    'wbs_list',
    'List WBS tasks. Optionally filter by assigned agent and/or status. Returns a markdown table.',
    {
      agent: z.string().optional().describe('Filter to tasks assigned to this agent (first name)'),
      status: z
        .enum(STATUSES)
        .optional()
        .describe('Filter by status: todo | in-progress | blocked | review | done'),
    },
    async ({ agent, status }) => {
      const conditions: string[] = []
      const params: string[] = []
      if (agent) {
        conditions.push('agent = ?')
        params.push(agent)
      }
      if (status) {
        conditions.push('status = ?')
        params.push(status)
      }
      const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
      const tasks = db
        .prepare<string[], TaskRow>(`SELECT * FROM tasks${where} ORDER BY id`)
        .all(...params)
      if (tasks.length === 0) return { content: [{ type: 'text', text: 'No tasks found.' }] }
      return { content: [{ type: 'text', text: formatTable(tasks) }] }
    },
  )

  // ── wbs_get ────────────────────────────────────────────────────────────────
  server.tool(
    'wbs_get',
    'Get full details of a single WBS task by ID (e.g. T-001).',
    {
      id: z.string().describe('Task ID, e.g. T-001'),
    },
    async ({ id }) => {
      const task = db.prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id)
      if (!task) {
        return { content: [{ type: 'text', text: `Task ${id} not found.` }], isError: true }
      }
      const detail = [
        `ID:           ${task.id}`,
        `Status:       ${task.status}`,
        `Agent:        ${task.agent}`,
        `Prereqs:      ${task.prereqs || '-'}`,
        `References:   ${task.refs || '-'}`,
        `Description:  ${task.description}`,
        `Created:      ${task.created_at}`,
        `Updated:      ${task.updated_at}`,
      ].join('\n')
      return { content: [{ type: 'text', text: detail }] }
    },
  )

  // ── wbs_add ────────────────────────────────────────────────────────────────
  server.tool(
    'wbs_add',
    'Add a new task to the WBS. Morgan (PM) use only. Returns the new task ID.',
    {
      description: z.string().describe('One-line description of the deliverable'),
      agent: z.string().describe('First name of the assigned agent (e.g. Alex)'),
      prereqs: z
        .string()
        .optional()
        .describe('Comma-separated prerequisite task IDs, e.g. "T-001,T-002", or leave blank'),
      refs: z
        .string()
        .optional()
        .describe('Spec sections, file paths, or issue numbers (e.g. "§9.5, §6.4")'),
    },
    async ({ description, agent, prereqs, refs }) => {
      const id = nextId()
      const ts = now()
      db.prepare(
        'INSERT INTO tasks (id, description, agent, status, prereqs, refs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, description, agent, 'todo', prereqs ?? '', refs ?? '', ts, ts)
      return {
        content: [{ type: 'text', text: `Task ${id} created and assigned to ${agent}.` }],
      }
    },
  )

  // ── wbs_update ─────────────────────────────────────────────────────────────
  server.tool(
    'wbs_update',
    'Update the status of a WBS task. Agents call this to report progress on their assigned work.',
    {
      id: z.string().describe('Task ID, e.g. T-001'),
      status: z
        .enum(STATUSES)
        .describe('New status: todo | in-progress | blocked | review | done'),
      note: z
        .string()
        .optional()
        .describe('Optional progress note appended to the task references, e.g. "branch: alex/session-api"'),
    },
    async ({ id, status, note }) => {
      const task = db.prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id)
      if (!task) {
        return { content: [{ type: 'text', text: `Task ${id} not found.` }], isError: true }
      }
      const newRefs = note
        ? task.refs
          ? `${task.refs} | ${note}`
          : note
        : task.refs
      db.prepare('UPDATE tasks SET status = ?, refs = ?, updated_at = ? WHERE id = ?').run(
        status,
        newRefs,
        now(),
        id,
      )
      return { content: [{ type: 'text', text: `Task ${id} → ${status}` }] }
    },
  )

  // ── wbs_delete ─────────────────────────────────────────────────────────────
  server.tool(
    'wbs_delete',
    'Delete a task from the WBS. Morgan (PM) use only. Use sparingly — prefer status "done".',
    {
      id: z.string().describe('Task ID to delete, e.g. T-001'),
    },
    async ({ id }) => {
      const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      if (result.changes === 0) {
        return { content: [{ type: 'text', text: `Task ${id} not found.` }], isError: true }
      }
      return { content: [{ type: 'text', text: `Task ${id} deleted.` }] }
    },
  )
}
