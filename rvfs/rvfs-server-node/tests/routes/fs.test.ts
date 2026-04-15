/**
 * §9.1 Filesystem Management endpoints
 * Covers FS CRUD, fork, node listing, TTL renew, and auth gates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs } from '../setup.js'

describe('POST /fs', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a filesystem and returns 201 with fsid, root_nid, label, created_at', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fs',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'my-sandbox', ttl: null },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.fsid).toBe('string')
    expect(body.fsid.length).toBeGreaterThan(0)
    expect(typeof body.root_nid).toBe('string')
    expect(body.root_nid.length).toBeGreaterThan(0)
    expect(body.label).toBe('my-sandbox')
    expect(typeof body.created_at).toBe('string')
  })

  it('returns 401 without Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fs',
      payload: { label: 'unauth-fs', ttl: null },
    })
    expect(res.statusCode).toBe(401)
  })

  it('stores a TTL when provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fs',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'ttl-fs', ttl: 3600 },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('GET /fs', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with items, cursor, has_more', async () => {
    await createFs(app, sessionId, 'fs-one')
    await createFs(app, sessionId, 'fs-two')

    const res = await app.inject({
      method: 'GET',
      url: '/fs',
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThanOrEqual(2)
    expect('cursor' in body).toBe(true)
    expect('has_more' in body).toBe(true)
  })

  it('each item has fsid, label, owner, access, created_at, ttl fields', async () => {
    await createFs(app, sessionId, 'shape-check')

    const res = await app.inject({
      method: 'GET',
      url: '/fs',
      headers: { authorization: `Bearer ${sessionId}` },
    })

    const { items } = res.json()
    const item = items[0]
    expect(typeof item.fsid).toBe('string')
    expect(typeof item.label).toBe('string')
    expect(typeof item.owner).toBe('string')
    expect(['read', 'write', 'admin']).toContain(item.access)
    expect(typeof item.created_at).toBe('string')
    expect('ttl' in item).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/fs' })
    expect(res.statusCode).toBe(401)
  })

  it('supports limit query parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await createFs(app, sessionId, `fs-limit-${i}`)
    }

    const res = await app.inject({
      method: 'GET',
      url: '/fs?limit=2',
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items.length).toBeLessThanOrEqual(2)
  })
})

describe('GET /fs/:fsid', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with the root meta node (RootMetaNode shape §3.1.1)', async () => {
    const { fsid } = await createFs(app, sessionId, 'root-node-check')

    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.type).toBe('root')
    expect(body.fsid).toBe(fsid)
    expect(typeof body.nid).toBe('string')
    expect(typeof body.label).toBe('string')
    expect(typeof body.created_at).toBe('string')
    expect(typeof body.updated_at).toBe('string')
    expect(Array.isArray(body.children)).toBe(true)
    expect(typeof body.name_index).toBe('object')
    expect(typeof body.fork_depth).toBe('number')
    expect(body.fork_of).toBeNull()
  })

  it('returns 404 for an unknown fsid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fs/fs-does-not-exist',
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({ method: 'GET', url: `/fs/${fsid}` })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /fs/:fsid', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('updates the filesystem label and returns 200', async () => {
    const { fsid } = await createFs(app, sessionId, 'old-label')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'new-label' },
    })

    expect(patchRes.statusCode).toBe(200)

    // Verify the label is persisted
    const getRes = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(getRes.json().label).toBe('new-label')
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({
      method: 'PATCH',
      url: `/fs/${fsid}`,
      payload: { label: 'hacked' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /fs/:fsid', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 204 on successful deletion', async () => {
    const { fsid } = await createFs(app, sessionId, 'to-delete')

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(delRes.statusCode).toBe(204)
  })

  it('returns 404 for GET after deletion', async () => {
    const { fsid } = await createFs(app, sessionId, 'delete-then-get')

    await app.inject({
      method: 'DELETE',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    const getRes = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({ method: 'DELETE', url: `/fs/${fsid}` })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /fs/:fsid/fork', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a fork and returns 201 with fsid, root_nid, fork_of, fork_depth: 1 (§8.3)', async () => {
    const { fsid: parentFsid } = await createFs(app, sessionId, 'parent')

    const forkRes = await app.inject({
      method: 'POST',
      url: `/fs/${parentFsid}/fork`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'forked', ttl: null, owner: 'test-user' },
    })

    expect(forkRes.statusCode).toBe(201)
    const body = forkRes.json()
    expect(typeof body.fsid).toBe('string')
    expect(body.fsid).not.toBe(parentFsid)
    expect(typeof body.root_nid).toBe('string')
    expect(body.fork_of).toBe(parentFsid)
    expect(body.fork_depth).toBe(1)
  })

  it('rejects fork-of-a-fork in V1 with 400 FORK_DEPTH_EXCEEDED (§8, §18)', async () => {
    const { fsid: parentFsid } = await createFs(app, sessionId, 'parent-v1')

    const fork1Res = await app.inject({
      method: 'POST',
      url: `/fs/${parentFsid}/fork`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'fork1', ttl: null, owner: 'test-user' },
    })
    const { fsid: fork1Fsid } = fork1Res.json()

    const fork2Res = await app.inject({
      method: 'POST',
      url: `/fs/${fork1Fsid}/fork`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { label: 'fork2', ttl: null, owner: 'test-user' },
    })

    expect(fork2Res.statusCode).toBe(400)
    expect(fork2Res.json().error).toBe('FORK_DEPTH_EXCEEDED')
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/fork`,
      payload: { label: 'fork', ttl: null, owner: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /fs/:fsid/nodes', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with nids, cursor, has_more (§9.1)', async () => {
    const { fsid } = await createFs(app, sessionId, 'nodes-list')

    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}/nodes`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.nids)).toBe(true)
    expect('cursor' in body).toBe(true)
    expect('has_more' in body).toBe(true)
  })

  it('includes the root node nid in the listing', async () => {
    const { fsid, root_nid } = await createFs(app, sessionId, 'nodes-root')

    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}/nodes`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(res.json().nids).toContain(root_nid)
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({ method: 'GET', url: `/fs/${fsid}/nodes` })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /fs/:fsid/ttl', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 and updates the TTL (§7.2)', async () => {
    const { fsid } = await createFs(app, sessionId, 'ttl-renew')

    const res = await app.inject({
      method: 'PATCH',
      url: `/fs/${fsid}/ttl`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { ttl: 86400 },
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 401 without auth', async () => {
    const { fsid } = await createFs(app, sessionId)
    const res = await app.inject({
      method: 'PATCH',
      url: `/fs/${fsid}/ttl`,
      payload: { ttl: 86400 },
    })
    expect(res.statusCode).toBe(401)
  })
})
