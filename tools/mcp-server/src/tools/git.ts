import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates that the given path exists and is a directory.
 * Rejects path traversal attempts using null bytes.
 */
async function validateCwd(cwd: string): Promise<string> {
  if (cwd.includes('\0')) {
    throw new Error('Invalid path: null byte in cwd')
  }
  const resolved = resolve(cwd)
  const info = await stat(resolved)
  if (!info.isDirectory()) {
    throw new Error(`cwd is not a directory: ${resolved}`)
  }
  return resolved
}

/**
 * Validates git subcommand args — rejects any arg containing null bytes.
 */
function validateArgs(args: string[]): string[] {
  for (const arg of args) {
    if (arg.includes('\0')) {
      throw new Error('Invalid argument: null byte detected')
    }
  }
  return args
}

// ── Tool: git_exec ─────────────────────────────────────────────────────────────

export function registerGitTools(server: McpServer): void {
  server.tool(
    'git_exec',
    [
      'Execute any git command in a given working directory.',
      'Pass the subcommand and its arguments as an array — do NOT include the "git" binary itself.',
      'Examples: ["status"], ["log", "--oneline", "-10"], ["diff", "HEAD~1"], ["commit", "-m", "feat: add thing"].',
      'The cwd must be an absolute path to an existing directory (inside or outside a git repo as appropriate).',
      'stdout and stderr from git are both returned so you can inspect errors or prompts.',
    ].join(' '),
    {
      cwd: z
        .string()
        .min(1)
        .describe('Absolute path to the directory in which to run the git command'),
      args: z
        .array(z.string())
        .min(1)
        .describe(
          'Git subcommand and its arguments as an array, e.g. ["log", "--oneline", "-5"] or ["commit", "-m", "message"]',
        ),
      env: z
        .record(z.string())
        .optional()
        .describe(
          'Optional extra environment variables to pass (e.g. {"GIT_AUTHOR_NAME": "Alex"}). Merged with a minimal safe env.',
        ),
      timeout: z
        .number()
        .int()
        .min(500)
        .max(120_000)
        .default(30_000)
        .describe('Timeout in milliseconds (default 30 s, max 120 s)'),
    },
    async ({ cwd, args, env, timeout }) => {
      // Validate inputs before touching the shell
      let resolvedCwd: string
      try {
        resolvedCwd = await validateCwd(cwd)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `ERROR (cwd): ${msg}` }], isError: true }
      }

      let safeArgs: string[]
      try {
        safeArgs = validateArgs(args)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `ERROR (args): ${msg}` }], isError: true }
      }

      // Build a minimal environment — inherit only what git actually needs.
      // We do NOT forward the full process.env to avoid leaking secrets.
      const safeEnv: Record<string, string> = {
        HOME: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
        PATH: process.env['PATH'] ?? '',
        // Git-specific env vars that may be set legitimately by callers
        GIT_AUTHOR_NAME: process.env['GIT_AUTHOR_NAME'] ?? '',
        GIT_AUTHOR_EMAIL: process.env['GIT_AUTHOR_EMAIL'] ?? '',
        GIT_COMMITTER_NAME: process.env['GIT_COMMITTER_NAME'] ?? '',
        GIT_COMMITTER_EMAIL: process.env['GIT_COMMITTER_EMAIL'] ?? '',
        // Windows: git needs HOMEDRIVE / APPDATA for config resolution
        ...(process.env['HOMEDRIVE'] ? { HOMEDRIVE: process.env['HOMEDRIVE'] } : {}),
        ...(process.env['APPDATA'] ? { APPDATA: process.env['APPDATA'] } : {}),
        ...(process.env['LOCALAPPDATA'] ? { LOCALAPPDATA: process.env['LOCALAPPDATA'] } : {}),
        // Let caller override / extend
        ...env,
      }
      // Strip empty-string values so git doesn't see empty HOME etc.
      for (const key of Object.keys(safeEnv)) {
        if (safeEnv[key] === '') delete safeEnv[key]
      }

      try {
        const { stdout, stderr } = await execFileAsync('git', safeArgs, {
          cwd: resolvedCwd,
          env: safeEnv,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
        })

        const result = [
          stdout.trim() ? `stdout:\n${stdout.trim()}` : 'stdout: (empty)',
          stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')

        return { content: [{ type: 'text', text: result }] }
      } catch (err: unknown) {
        // execFile rejects when exit code ≠ 0 — treat git errors as isError so
        // the calling agent knows the command failed.
        const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: unknown }
        const parts: string[] = []
        if (e.stdout?.trim()) parts.push(`stdout:\n${e.stdout.trim()}`)
        if (e.stderr?.trim()) parts.push(`stderr:\n${e.stderr.trim()}`)
        parts.push(`exit code: ${String(e.code ?? 'unknown')}`)
        return {
          content: [{ type: 'text', text: parts.join('\n\n') }],
          isError: true,
        }
      }
    },
  )
}
