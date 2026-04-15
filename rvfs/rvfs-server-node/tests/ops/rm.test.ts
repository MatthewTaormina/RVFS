/**
 * §9.4 POST /fs/:fsid/op/rm
 * Covers: remove file, ENOENT, non-empty dir without recursive, recursive removal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs, opCreate } from '../setup.js'

describe('POST /fs/:fsid/op/rm', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-rm-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('removes a file and returns 200', async () => {
    await opCreate(app, sessionId, fsid, { path: '/remove-me.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/remove-me.txt' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('file no longer accessible via op/read after removal', async () => {
    await opCreate(app, sessionId, fsid, { path: '/gone.txt', type: 'file' })

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/gone.txt' },
    })

    const readRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/gone.txt' },
    })
    expect(readRes.statusCode).toBe(404)
  })

  it('returns 404 (ENOENT) for a nonexistent path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/does-not-exist.txt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('returns 400 (ENOTEMPTY) when removing a non-empty dir without recursive flag (§13)', async () => {
    await opCreate(app, sessionId, fsid, { path: '/mydir', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/mydir/file.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/mydir', recursive: false },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('ENOTEMPTY')
  })

  it('removes a directory tree with recursive: true and returns 200', async () => {
    await opCreate(app, sessionId, fsid, { path: '/tree', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/tree/a.txt', type: 'file' })
    await opCreate(app, sessionId, fsid, { path: '/tree/subdir', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/tree/subdir/b.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/tree', recursive: true },
    })

    expect(res.statusCode).toBe(200)

    // Root dir must also be gone
    const readRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/tree' },
    })
    expect(readRes.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/rm`,
      payload: { path: '/noauth.txt' },
    })
    expect(res.statusCode).toBe(401)
  })
})
