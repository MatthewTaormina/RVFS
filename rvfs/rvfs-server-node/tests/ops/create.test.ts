/**
 * §9.4 POST /fs/:fsid/op/create
 * Covers file, dir, symlink creation; error cases: ENOENT (missing parent),
 * EEXIST (duplicate path).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs } from '../setup.js'

describe('POST /fs/:fsid/op/create — file', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-create-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a file and returns 201 with nid and path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/hello.txt', type: 'file' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.nid).toBe('string')
    expect(body.path).toBe('/hello.txt')
  })

  it('creates a file with initial text content — blob_nid is set on the meta node', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/with-content.txt', type: 'file', content: 'initial data' },
    })

    expect(res.statusCode).toBe(201)
    const { nid } = res.json()

    // The resulting file meta node must have a blob_nid
    const nodeRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(nodeRes.statusCode).toBe(200)
    const node = nodeRes.json()
    expect(node.blob_nid).not.toBeNull()
    expect(typeof node.blob_nid).toBe('string')
  })

  it('creates a file with a custom mode via meta override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        path: '/script.sh',
        type: 'file',
        meta: { mode: 0o755 },
      },
    })

    expect(res.statusCode).toBe(201)
    const { nid } = res.json()

    const nodeRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(nodeRes.json().meta.mode).toBe(0o755)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      payload: { path: '/no-auth.txt', type: 'file' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /fs/:fsid/op/create — directory', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-create-dir')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a directory and returns 201 with type dir', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/mydir', type: 'dir' },
    })

    expect(res.statusCode).toBe(201)
    const { nid } = res.json()

    const nodeRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(nodeRes.json().type).toBe('dir')
  })

  it('creates a nested directory whose parent already exists', async () => {
    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/parent', type: 'dir' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/parent/child', type: 'dir' },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('POST /fs/:fsid/op/create — symlink', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-create-symlink')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('creates a symlink and returns 201 — symlink_target is set on the meta node', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        path: '/link.txt',
        type: 'symlink',
        symlink_target: '/home/learner/real.txt',
      },
    })

    expect(res.statusCode).toBe(201)
    const { nid } = res.json()

    const nodeRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const node = nodeRes.json()
    expect(node.symlink_target).toBe('/home/learner/real.txt')
    expect(node.blob_nid).toBeNull()
  })
})

describe('POST /fs/:fsid/op/create — error cases', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-create-errors')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 (ENOENT) when parent directory does not exist (§13)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/nonexistent-parent/file.txt', type: 'file' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('returns 409 (EEXIST) when path already exists (§13)', async () => {
    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/existing.txt', type: 'file' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/existing.txt', type: 'file' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('EEXIST')
  })

  it('returns 400 for path traversal attempt — ../ in path (§14.4)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/../../etc/passwd', type: 'file' },
    })

    expect(res.statusCode).toBe(400)
  })
})
