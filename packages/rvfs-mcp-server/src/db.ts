import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// DB lives at {workspace_root}/.mcp-data/team.db (gitignored).
// Override with RVFS_MCP_DB_PATH env var if needed.
const DB_PATH = process.env['RVFS_MCP_DB_PATH'] ?? join(process.cwd(), '.mcp-data', 'team.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  -- ── WBS Tasks ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    agent       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'todo',
    prereqs     TEXT NOT NULL DEFAULT '',
    refs        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_agent  ON tasks(agent);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  -- ── Agent Memories (persistent key-value per agent) ──────────────────────
  CREATE TABLE IF NOT EXISTS memories (
    agent      TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (agent, key)
  );

  -- ── Scratchpads (freeform working notes per agent) ────────────────────────
  CREATE TABLE IF NOT EXISTS scratchpads (
    agent      TEXT PRIMARY KEY,
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  -- ── Message Queue (agent-to-agent async messages) ─────────────────────────
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_agent TEXT NOT NULL,
    to_agent   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(to_agent, read);
`)

process.stderr.write(`rvfs-mcp: database at ${DB_PATH}\n`)

export function now(): string {
  return new Date().toISOString()
}

// ── Typed row shapes ──────────────────────────────────────────────────────────

export interface TaskRow {
  id: string
  description: string
  agent: string
  status: string
  prereqs: string
  refs: string
  created_at: string
  updated_at: string
}

export interface MemoryRow {
  agent: string
  key: string
  value: string
  updated_at: string
}

export interface ScratchpadRow {
  agent: string
  content: string
  updated_at: string
}

export interface MessageRow {
  id: number
  from_agent: string
  to_agent: string
  subject: string
  body: string
  read: number
  created_at: string
}
