/**
 * §9.4 POST /fs/:fsid/op/mv
 * Covers: move/rename, ENOENT source, ENOENT destination parent, clobber.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs, opCreate } from '../setup.js'

describe('POST /fs/:fsid/op/mv', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-mv-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('moves a file to a new path and returns 200', async () => {
    await opCreate(app, sessionId, fsid, { path: '/old-name.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/old-name.txt', dst: '/new-name.txt' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('file is accessible at dst and gone from src after move', async () => {
    await opCreate(app, sessionId, fsid, {
      path: '/move-src.txt',
      type: 'file',
      content: 'content',
    })

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/move-src.txt', dst: '/move-dst.txt' },
    })

    const dstRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/move-dst.txt' },
    })
    expect(dstRes.statusCode).toBe(200)

    const srcRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/move-src.txt' },
    })
    expect(srcRes.statusCode).toBe(404)
  })

  it('renames a directory', async () => {
    await opCreate(app, sessionId, fsid, { path: '/old-dir', type: 'dir' })
    await opCreate(app, sessionId, fsid, { path: '/old-dir/file.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/old-dir', dst: '/new-dir' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 404 (ENOENT) when source does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/no-such-file.txt', dst: '/anywhere.txt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('returns 404 (ENOENT) when destination parent does not exist', async () => {
    await opCreate(app, sessionId, fsid, { path: '/source.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/source.txt', dst: '/missing-parent/dest.txt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('overwrites destination (clobber) when the path already exists', async () => {
    await opCreate(app, sessionId, fsid, {
      path: '/a.txt',
      type: 'file',
      content: 'from a',
    })
    await opCreate(app, sessionId, fsid, {
      path: '/b.txt',
      type: 'file',
      content: 'from b',
    })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { src: '/a.txt', dst: '/b.txt' },
    })

    // Clobber should succeed
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/mv`,
      payload: { src: '/a.txt', dst: '/b.txt' },
    })
    expect(res.statusCode).toBe(401)
  })
})
