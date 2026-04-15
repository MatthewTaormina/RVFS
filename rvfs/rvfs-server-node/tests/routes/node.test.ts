/**
 * §9.2 Node Operations — GET/PUT/PATCH/DELETE /node/:nid + TTL renew
 * Tests operate on meta nodes directly via the low-level node API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs } from '../setup.js'
import type { FileMetaNode } from 'rvfs-types'

const NOW = new Date().toISOString()

function makeFileNode(overrides: Partial<FileMetaNode> = {}): Partial<FileMetaNode> {
  return {
    nid: crypto.randomUUID(),
    type: 'file',
    name: 'test.txt',
    parent_nid: null,
    fsid: 'fs-placeholder',
    created_at: NOW,
    updated_at: NOW,
    ttl: null,
    meta: {
      mode: 0o644,
      uid: 1000,
      gid: 1000,
      atime: NOW,
      mtime: NOW,
      ctime: NOW,
      nlink: 1,
      inode: 12345,
    },
    blob_nid: null,
    size: 0,
    symlink_target: null,
    ...overrides,
  }
}

describe('PUT /node/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'node-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a meta node and returns 200', async () => {
    const nid = crypto.randomUUID()
    const node = makeFileNode({ nid, fsid })

    const res = await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: node,
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 401 without auth', async () => {
    const nid = crypto.randomUUID()
    const res = await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      payload: makeFileNode({ nid, fsid }),
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /node/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'get-node-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with the stored node', async () => {
    const nid = crypto.randomUUID()
    const node = makeFileNode({ nid, fsid, name: 'hello.txt' })

    await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: node,
    })

    const getRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(getRes.statusCode).toBe(200)
    const body = getRes.json()
    expect(body.nid).toBe(nid)
    expect(body.type).toBe('file')
    expect(body.name).toBe('hello.txt')
  })

  it('returns 404 for an unknown nid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/node/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/node/${crypto.randomUUID()}`,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /node/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'patch-node-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('applies a partial update and returns 200', async () => {
    const nid = crypto.randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: makeFileNode({ nid, fsid, name: 'before.txt' }),
    })

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { name: 'after.txt' },
    })

    expect(patchRes.statusCode).toBe(200)

    // Verify the patch was applied
    const getRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(getRes.json().name).toBe('after.txt')
  })

  it('returns 404 for unknown nid', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/node/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { name: 'ghost.txt' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/node/${crypto.randomUUID()}`,
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /node/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'delete-node-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 204 and node is gone afterward', async () => {
    const nid = crypto.randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: makeFileNode({ nid, fsid }),
    })

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(delRes.statusCode).toBe(204)

    const getRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/node/${crypto.randomUUID()}`,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /node/:nid/ttl', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'node-ttl-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 and updates the node TTL (§7.2)', async () => {
    const nid = crypto.randomUUID()
    await app.inject({
      method: 'PUT',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: makeFileNode({ nid, fsid }),
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/node/${nid}/ttl`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { ttl: 7200 },
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/node/${crypto.randomUUID()}/ttl`,
      payload: { ttl: 7200 },
    })
    expect(res.statusCode).toBe(401)
  })
})
