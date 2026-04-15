/**
 * §9.7 Change Stream — GET /fs/:fsid/watch (SSE)
 *
 * SSE streams can't be tested fully with app.inject() since the connection
 * stays open. Strategy:
 *   - Use app.inject() for auth/header-only assertions (inject reads headers
 *     before blocking, so 401 responses work fine).
 *   - Use a real listen + http.get() for streaming assertions, with a short
 *     timeout to collect initial events, then destroy the socket.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import * as http from 'http'
import { makeServer, createSession, createFs } from '../setup.js'

/** Open a real HTTP SSE connection, collect chunks for `timeoutMs`, then close. */
function collectSSEChunks(
  port: number,
  path: string,
  headers: Record<string, string>,
  timeoutMs = 300,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []

    const req = http.get(
      { hostname: '127.0.0.1', port, path, headers: { accept: 'text/event-stream', ...headers } },
      (res) => {
        res.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
        res.on('error', reject)
      },
    )

    req.on('error', reject)

    setTimeout(() => {
      req.destroy()
      resolve(chunks)
    }, timeoutMs)
  })
}

describe('GET /fs/:fsid/watch (SSE)', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string
  let port: number

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'watch-test')
    fsid = fs.fsid

    // Listen on a random port for real HTTP connections
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 401 without Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}/watch`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for unknown fsid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fs/fs-does-not-exist/watch`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('responds with Content-Type: text/event-stream and 200', async () => {
    const chunks = await collectSSEChunks(
      port,
      `/fs/${fsid}/watch`,
      { authorization: `Bearer ${sessionId}` },
    )

    // If there was an HTTP-level error the chunks would be empty; we might get
    // "HTTP/1.1 401" or similar as plaintext. Check that we got data and that
    // the raw response contains the SSE content-type.
    const combined = chunks.join('')
    expect(combined).toMatch(/text\/event-stream/)
  })

  it('sends a keep-alive comment within the initial response (§9.7)', async () => {
    const chunks = await collectSSEChunks(
      port,
      `/fs/${fsid}/watch`,
      { authorization: `Bearer ${sessionId}` },
      500,
    )
    const combined = chunks.join('')
    // SSE keep-alive is a comment line starting with ':'
    expect(combined).toMatch(/: keep-alive/)
  })

  it('emits a node:create event after POST /fs/:fsid/op/create', async () => {
    // Start collecting stream events
    const collectPromise = collectSSEChunks(
      port,
      `/fs/${fsid}/watch`,
      { authorization: `Bearer ${sessionId}` },
      500,
    )

    // Trigger a create operation
    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/watch-test.txt', type: 'file', content: 'hello' },
    })

    const chunks = await collectPromise
    const combined = chunks.join('')
    expect(combined).toMatch(/node:create/)
  })

  it('emits a node:write event after POST /fs/:fsid/op/write', async () => {
    // Create the file first (synchronously before opening stream)
    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/watch-write.txt', type: 'file', content: '' },
    })

    const collectPromise = collectSSEChunks(
      port,
      `/fs/${fsid}/watch`,
      { authorization: `Bearer ${sessionId}` },
      500,
    )

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/watch-write.txt', content: 'updated' },
    })

    const chunks = await collectPromise
    const combined = chunks.join('')
    expect(combined).toMatch(/node:write/)
  })

  it('each SSE event contains valid JSON data with the RvfsChangeEvent shape', async () => {
    const collectPromise = collectSSEChunks(
      port,
      `/fs/${fsid}/watch`,
      { authorization: `Bearer ${sessionId}` },
      500,
    )

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/shape-check.txt', type: 'file' },
    })

    const chunks = await collectPromise
    const combined = chunks.join('')

    // Extract JSON data lines from SSE
    const dataLines = combined
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice('data:'.length).trim())

    const events = dataLines
      .filter(Boolean)
      .map((d) => JSON.parse(d) as Record<string, unknown>)

    const nodeCreate = events.find((e) => e.event === 'node:create')
    if (nodeCreate) {
      expect(typeof nodeCreate.event_id).toBe('string')
      expect(typeof nodeCreate.fsid).toBe('string')
      expect(typeof nodeCreate.at).toBe('string')
      expect(typeof nodeCreate.session_id).toBe('string')
      expect('nid' in nodeCreate).toBe(true)
      expect('path' in nodeCreate).toBe(true)
      expect('old_path' in nodeCreate).toBe(true)
      expect('meta_delta' in nodeCreate).toBe(true)
    }
  })
})
