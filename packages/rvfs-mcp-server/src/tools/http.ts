import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// ── Shared fetch helper ────────────────────────────────────────────────────────

interface FetchResult {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  durationMs: number
  error?: string
}

async function doFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'rvfs-mcp/1.0', ...headers },
      body: body ?? undefined,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const bodyText = await res.text()
    return {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: bodyText,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    return { status: 0, statusText: 'Error', headers: {}, body: '', durationMs: Date.now() - start, error: message }
  }
}

// ── Tool: http_request ─────────────────────────────────────────────────────────

const HttpRequestSchema = {
  url: z.string().url().describe('Full URL including query string if needed'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    .default('GET')
    .describe('HTTP method'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Request headers as key-value pairs, e.g. {"Authorization": "Bearer token"}'),
  body: z
    .string()
    .optional()
    .describe('Request body — JSON string or plain text; only for POST/PUT/PATCH'),
  timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(10000)
    .describe('Request timeout in milliseconds (100–30000)'),
}

// ── Tool: rest_api_test ────────────────────────────────────────────────────────

const RestApiTestSchema = {
  url: z.string().url().describe('Full URL to test'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .default('GET')
    .describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('Request headers'),
  body: z.string().optional().describe('Request body'),
  expected_status: z
    .number()
    .int()
    .optional()
    .describe('Assert response status code equals this value'),
  expected_body_contains: z
    .string()
    .optional()
    .describe('Assert response body contains this exact substring'),
  expected_json_field: z
    .string()
    .optional()
    .describe('Assert this dot-notated JSON field exists and is truthy, e.g. "data.id"'),
  timeout_ms: z.number().int().min(100).max(30000).default(10000),
}

// ── Tool: check_rvfs_server ────────────────────────────────────────────────────

const CheckRvfsServerSchema = {
  base_url: z
    .string()
    .url()
    .default('http://localhost:3000')
    .describe('Base URL of the RVFS server, e.g. http://localhost:3000'),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getJsonField(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerHttpTools(server: McpServer): void {
  // ── http_request ──────────────────────────────────────────────────────────
  server.tool(
    'http_request',
    'Make an HTTP request to any URL and return the status code, response headers, body, and duration. Useful for manually exercising API endpoints during development.',
    HttpRequestSchema,
    async ({ url, method, headers, body, timeout_ms }) => {
      const result = await doFetch(url, method, headers ?? {}, body, timeout_ms)
      if (result.error) {
        return {
          content: [{ type: 'text', text: `REQUEST FAILED\n\nError: ${result.error}\nURL: ${url}\nMethod: ${method}\nDuration: ${result.durationMs}ms` }],
          isError: true,
        }
      }
      const output = [
        `HTTP ${result.status} ${result.statusText}  (${result.durationMs}ms)`,
        `URL: ${method} ${url}`,
        '',
        '── Response Headers ─────────────────────',
        ...Object.entries(result.headers).map(([k, v]) => `  ${k}: ${v}`),
        '',
        '── Response Body ────────────────────────',
        result.body || '(empty)',
      ].join('\n')
      return { content: [{ type: 'text', text: output }] }
    },
  )

  // ── rest_api_test ─────────────────────────────────────────────────────────
  server.tool(
    'rest_api_test',
    'Make an HTTP request and assert the response against expected values. Returns PASS or FAIL with a detailed breakdown. Use this to verify API endpoints behave as specified.',
    RestApiTestSchema,
    async ({ url, method, headers, body, expected_status, expected_body_contains, expected_json_field, timeout_ms }) => {
      const result = await doFetch(url, method, headers ?? {}, body, timeout_ms)

      const assertions: Array<{ label: string; pass: boolean; detail: string }> = []

      if (result.error) {
        assertions.push({ label: 'Request succeeded', pass: false, detail: result.error })
      } else {
        if (expected_status !== undefined) {
          const pass = result.status === expected_status
          assertions.push({
            label: `Status code = ${expected_status}`,
            pass,
            detail: pass ? `✓ Got ${result.status}` : `✗ Got ${result.status}, expected ${expected_status}`,
          })
        }

        if (expected_body_contains !== undefined) {
          const pass = result.body.includes(expected_body_contains)
          assertions.push({
            label: `Body contains "${expected_body_contains}"`,
            pass,
            detail: pass ? '✓ Found in body' : `✗ Not found. Body preview: ${result.body.slice(0, 200)}`,
          })
        }

        if (expected_json_field !== undefined) {
          let parsed: unknown
          let parseOk = true
          try { parsed = JSON.parse(result.body) } catch { parseOk = false }
          if (!parseOk) {
            assertions.push({ label: `JSON field "${expected_json_field}" exists`, pass: false, detail: '✗ Response body is not valid JSON' })
          } else {
            const value = getJsonField(parsed, expected_json_field)
            const pass = value !== undefined && value !== null && value !== false && value !== 0
            assertions.push({
              label: `JSON field "${expected_json_field}" is truthy`,
              pass,
              detail: pass ? `✓ Value: ${JSON.stringify(value)}` : `✗ Value: ${JSON.stringify(value)}`,
            })
          }
        }
      }

      const allPass = assertions.every((a) => a.pass)
      const summary = allPass ? '✅ PASS' : '❌ FAIL'
      const lines = [
        `${summary} — ${method} ${url}  (${result.durationMs}ms, HTTP ${result.status})`,
        '',
        '── Assertions ───────────────────────────',
        ...assertions.map((a) => `  ${a.pass ? '✓' : '✗'} ${a.label}\n      ${a.detail}`),
      ]

      if (!allPass) {
        lines.push('', '── Response Body ────────────────────────', result.body.slice(0, 1000) || '(empty)')
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        isError: !allPass,
      }
    },
  )

  // ── check_rvfs_server ─────────────────────────────────────────────────────
  server.tool(
    'check_rvfs_server',
    'Check whether an RVFS server is running and healthy by calling its GET /ping endpoint. Returns server version and response time.',
    CheckRvfsServerSchema,
    async ({ base_url }) => {
      const url = base_url.replace(/\/$/, '') + '/ping'
      const result = await doFetch(url, 'GET', {}, undefined, 5000)

      if (result.error) {
        return {
          content: [{ type: 'text', text: `❌ RVFS server unreachable\n\nURL: ${url}\nError: ${result.error}\n\nMake sure the server is running. Try: pnpm --filter rvfs-server-node start` }],
          isError: true,
        }
      }

      if (result.status !== 200) {
        return {
          content: [{ type: 'text', text: `❌ RVFS server returned HTTP ${result.status}\n\nURL: ${url}\nBody: ${result.body}` }],
          isError: true,
        }
      }

      let parsed: unknown
      try { parsed = JSON.parse(result.body) } catch { /* ignore */ }
      const version = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).version ?? 'unknown' : 'unknown'

      return {
        content: [{ type: 'text', text: `✅ RVFS server is healthy\n\nURL: ${base_url}\nVersion: ${version}\nResponse time: ${result.durationMs}ms` }],
      }
    },
  )
}
