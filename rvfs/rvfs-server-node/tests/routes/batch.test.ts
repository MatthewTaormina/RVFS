/**
 * §9.6 Batch Request — POST /batch
 * Covers batch envelope shape, mixed success/failure, and the 100-op limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs } from '../setup.js'

describe('POST /batch', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'batch-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with responses array matching each request id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [
          { id: 'req-1', method: 'GET', path: '/ping' },
          { id: 'req-2', method: 'GET', path: `/fs/${fsid}` },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.responses)).toBe(true)
    expect(body.responses).toHaveLength(2)

    const ids = body.responses.map((r: { id: string }) => r.id)
    expect(ids).toContain('req-1')
    expect(ids).toContain('req-2')
  })

  it('each response has id, status, and body fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [{ id: 'r1', method: 'GET', path: '/ping' }],
      },
    })

    const { responses } = res.json()
    const r = responses[0]
    expect(typeof r.id).toBe('string')
    expect(typeof r.status).toBe('number')
    expect('body' in r).toBe(true)
  })

  it('processes mixed valid/invalid requests and returns appropriate per-item status codes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [
          { id: 'good', method: 'GET', path: '/ping' },
          { id: 'bad', method: 'GET', path: `/node/${crypto.randomUUID()}` },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const { responses } = res.json()

    const good = responses.find((r: { id: string }) => r.id === 'good')
    const bad = responses.find((r: { id: string }) => r.id === 'bad')

    expect(good.status).toBe(200)
    expect(bad.status).toBe(404)
  })

  it('returns 400 when batch size exceeds 100 operations (§9.6)', async () => {
    const requests = Array.from({ length: 101 }, (_, i) => ({
      id: `req-${i}`,
      method: 'GET',
      path: '/ping',
    }))

    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { requests },
    })

    expect(res.statusCode).toBe(400)
  })

  it('exactly 100 operations is accepted', async () => {
    const requests = Array.from({ length: 100 }, (_, i) => ({
      id: `req-${i}`,
      method: 'GET',
      path: '/ping',
    }))

    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { requests },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().responses).toHaveLength(100)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      payload: { requests: [{ id: '1', method: 'GET', path: '/ping' }] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when requests field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when requests is not an array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { requests: 'not-an-array' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST batch sub-request with a body is forwarded correctly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [
          {
            id: 'create-session',
            method: 'POST',
            path: '/session',
            body: { identity: 'batch-user', ttl_seconds: 3600, filesystems: [] },
          },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const { responses } = res.json()
    expect(responses[0].status).toBe(201)
    expect(typeof responses[0].body.session_id).toBe('string')
  })
})
