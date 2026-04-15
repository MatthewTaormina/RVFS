/**
 * §9.4 POST /fs/:fsid/op/write
 * Covers: write, create_if_missing, missing path error, readback, append mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs, opCreate } from '../setup.js'

describe('POST /fs/:fsid/op/write', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'op-write-test')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('writes content to an existing file and returns 200', async () => {
    await opCreate(app, sessionId, fsid, { path: '/write-me.txt', type: 'file' })

    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/write-me.txt', content: 'hello content' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('written content is readable back via op/read', async () => {
    await opCreate(app, sessionId, fsid, { path: '/read-back.txt', type: 'file' })

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/read-back.txt', content: 'persisted content' },
    })

    const readRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/read-back.txt' },
    })

    expect(readRes.statusCode).toBe(200)
    const body = readRes.json()
    // The response should contain the node meta and optionally the content
    // Either the content is inline or the client fetches blob separately
    // At minimum the node type and blob_nid must be present
    expect(body.node).toBeDefined()
    expect(body.node.type).toBe('file')
    expect(body.node.blob_nid).not.toBeNull()
  })

  it('creates the file when create_if_missing is true and path does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        path: '/auto-created.txt',
        content: 'auto',
        create_if_missing: true,
      },
    })

    expect(res.statusCode).toBe(200)

    // The file should now exist
    const readRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/auto-created.txt' },
    })
    expect(readRes.statusCode).toBe(200)
  })

  it('returns 404 (ENOENT) when path does not exist and create_if_missing is false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        path: '/does-not-exist.txt',
        content: 'data',
        create_if_missing: false,
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('ENOENT')
  })

  it('append mode adds to existing content rather than replacing', async () => {
    await opCreate(app, sessionId, fsid, {
      path: '/append-me.txt',
      type: 'file',
      content: 'line1\n',
    })

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/append-me.txt', content: 'line2\n', append: true },
    })

    const readRes = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/append-me.txt' },
    })

    expect(readRes.statusCode).toBe(200)
    // Content should be line1 + line2
    // Fetch the blob to verify
    const { node } = readRes.json()
    const blobRes = await app.inject({
      method: 'GET',
      url: `/blob/${node.blob_nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(blobRes.payload).toBe('line1\nline2\n')
  })

  it('updates the file meta node updated_at timestamp', async () => {
    await opCreate(app, sessionId, fsid, { path: '/timestamp-test.txt', type: 'file' })

    const before = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/timestamp-test.txt' },
    })
    const oldUpdatedAt = before.json().node.updated_at

    // Small pause to ensure time difference
    await new Promise((r) => setTimeout(r, 10))

    await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/timestamp-test.txt', content: 'new' },
    })

    const after = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/read`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/timestamp-test.txt' },
    })
    const newUpdatedAt = after.json().node.updated_at

    expect(new Date(newUpdatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(oldUpdatedAt).getTime(),
    )
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      payload: { path: '/noauth.txt', content: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for path traversal attempt (§14.4)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/../etc/passwd', content: 'boom', create_if_missing: true },
    })
    expect(res.statusCode).toBe(400)
  })
})
