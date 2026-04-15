/**
 * §9.4 POST /fs/:fsid/op/cp
 * Covers: copy file, copy dir (recursive flag), ENOENT source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs, opCreate } from '../setup.js'

describe('POST /fs/:fsid/op/cp', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-cp-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('copies a file to a new path and returns 200', async () => {
    await opCreate(app, sessionId, fsid, {
      path: '/original.txt',
      type: 'file',
      content: 'copy me',
    })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/original.txt', dst: '/copy.txt' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('copy is independent — original still accessible after copy', async () => {
    await opCreate(app, sessionId, fsid, {
      path: '/orig.txt',
      type: 'file',
      content: 'source',
    })

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/orig.txt', dst: '/dup.txt' },
    })

    const origRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/orig.txt' },
    })
    expect(origRes.statusCode).toBe(200)

    const dupRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/dup.txt' },
    })
    expect(dupRes.statusCode).toBe(200)
  })

  it('returns 400 when copying a directory without recursive: true', async () => {
    await opCreate(app, sessionId, fsid, { path: '/srcdir', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/srcdir/f.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/srcdir', dst: '/dstdir', recursive: false },
    })

    expect(res.statusCode).toBe(400)
    // Should signal EISDIR or a similar error
    expect(['EISDIR', 'EINVAL']).toContain(res.json().error)
  })

  it('copies a directory tree with recursive: true and returns 200', async () => {
    await opCreate(app, sessionId, fsid, { path: '/src-tree', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/src-tree/x.txt', type: 'file', content: 'x' })
    await opCreate(app, sessionId, fsid, { path: '/src-tree/sub', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/src-tree/sub/y.txt', type: 'file', content: 'y' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/src-tree', dst: '/dst-tree', recursive: true },
    })

    expect(res.statusCode).toBe(200)

    // Deep copy should be accessible
    const childRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/dst-tree/sub/y.txt' },
    })
    expect(childRes.statusCode).toBe(200)
  })

  it('returns 404 (ENOENT) when source does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/ghost.txt', dst: '/copy.txt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/cp`,
      payload: { src: '/a.txt', dst: '/b.txt' },
    })
    expect(res.statusCode).toBe(401)
  })
})
