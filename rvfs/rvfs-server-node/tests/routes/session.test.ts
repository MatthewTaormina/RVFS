/**
 * §9.5 Session Management endpoints
 * Covers §6 Session object shape and §6.4 lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer } from '../setup.js'

describe('POST /session', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = makeServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a guest session and returns 201 with full session object', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'guest', ttl_seconds: 86400, filesystems: [] },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.session_id).toBe('string')
    expect(body.session_id.length).toBeGreaterThan(0)
    expect(body.identity).toBe('guest')
    expect(typeof body.created_at).toBe('string')
    expect(typeof body.expires_at).toBe('string')
    expect(body.ttl_seconds).toBe(86400)
    expect(Array.isArray(body.filesystems)).toBe(true)
    expect(typeof body.metadata).toBe('object')
  })

  it('creates an authenticated user session and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-123', ttl_seconds: 2592000, filesystems: [] },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.identity).toBe('user-123')
    expect(body.ttl_seconds).toBe(2592000)
  })

  it('session_id is a valid UUID v4 (128-bit random, §6.1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-abc', ttl_seconds: 3600, filesystems: [] },
    })

    const { session_id } = res.json()
    expect(session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('expires_at is ttl_seconds in the future', async () => {
    const before = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-ttl', ttl_seconds: 3600, filesystems: [] },
    })
    const after = Date.now()

    const { expires_at, created_at } = res.json()
    const createdMs = new Date(created_at).getTime()
    const expiresMs = new Date(expires_at).getTime()

    expect(createdMs).toBeGreaterThanOrEqual(before)
    expect(createdMs).toBeLessThanOrEqual(after)
    // expires_at should be ~3600s after created_at (allow 5s tolerance)
    expect(expiresMs - createdMs).toBeGreaterThanOrEqual(3595 * 1000)
    expect(expiresMs - createdMs).toBeLessThanOrEqual(3605 * 1000)
  })

  it('accepts filesystems access list in the payload', async () => {
    // First create an FS to reference — but since we have no session yet
    // we just check the shape is accepted (actual access is tested in auth tests)
    const res = await app.inject({
      method: 'POST',
      url: '/session',
      payload: {
        identity: 'user-fs',
        ttl_seconds: 3600,
        filesystems: [{ fsid: 'fs-nonexistent', access: 'write' }],
      },
    })
    // May return 201 or a validation error — implementation decides whether to
    // validate fsid existence; test the shape either way
    expect([201, 400, 422]).toContain(res.statusCode)
  })
})

describe('GET /session/:session_id', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = makeServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with the session object for a valid session', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-get', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id } = createRes.json()

    const getRes = await app.inject({
      method: 'GET',
      url: `/session/${session_id}`,
      headers: { authorization: `Bearer ${session_id}` },
    })

    expect(getRes.statusCode).toBe(200)
    const body = getRes.json()
    expect(body.session_id).toBe(session_id)
    expect(body.identity).toBe('user-get')
  })

  it('returns 404 for an unknown session_id', async () => {
    // Create a real session to use as the caller bearer token
    const callerRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-caller', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id: callerToken } = callerRes.json()

    // Look up a different, non-existent session_id — server returns 404 (before IDOR check)
    const fakeId = crypto.randomUUID()
    const res = await app.inject({
      method: 'GET',
      url: `/session/${fakeId}`,
      headers: { authorization: `Bearer ${callerToken}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 when no Authorization header is provided', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-noauth', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id } = createRes.json()

    const getRes = await app.inject({
      method: 'GET',
      url: `/session/${session_id}`,
      // no authorization header
    })
    expect(getRes.statusCode).toBe(401)
  })
})

describe('DELETE /session/:session_id', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = makeServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 204 on successful revocation', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-del', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id } = createRes.json()

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/session/${session_id}`,
      headers: { authorization: `Bearer ${session_id}` },
    })
    expect(delRes.statusCode).toBe(204)
  })

  it('returns 401 on subsequent requests after session is revoked (§6.4)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-revoke', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id } = createRes.json()

    // Revoke it
    await app.inject({
      method: 'DELETE',
      url: `/session/${session_id}`,
      headers: { authorization: `Bearer ${session_id}` },
    })

    // Subsequent GET with the revoked token must fail
    const getRes = await app.inject({
      method: 'GET',
      url: `/session/${session_id}`,
      headers: { authorization: `Bearer ${session_id}` },
    })
    expect(getRes.statusCode).toBe(401)
  })
})

describe('PATCH /session/:session_id/ttl', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = makeServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with updated expires_at (§7.2)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-ttl-patch', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id, expires_at: originalExpiry } = createRes.json()

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/session/${session_id}/ttl`,
      headers: { authorization: `Bearer ${session_id}` },
      payload: { ttl_seconds: 7200 },
    })

    expect(patchRes.statusCode).toBe(200)
    const body = patchRes.json()
    expect(typeof body.expires_at).toBe('string')
    // New expiry must be later than the original
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(
      new Date(originalExpiry).getTime(),
    )
  })

  it('returns 401 without auth', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/session',
      payload: { identity: 'user-ttl-noauth', ttl_seconds: 3600, filesystems: [] },
    })
    const { session_id } = createRes.json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/session/${session_id}/ttl`,
      payload: { ttl_seconds: 7200 },
    })
    expect(res.statusCode).toBe(401)
  })
})
