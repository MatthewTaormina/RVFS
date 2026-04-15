/**
 * §9.3 Blob Operations — POST/GET/HEAD/DELETE /blob
 * Covers upload, download, header-only fetch, ref_count guard, and SHA-256 integrity (§14.3).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs } from '../setup.js'
import { createHash } from 'crypto'

/** Compute hex SHA-256 of a Buffer. */
function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe('POST /blob', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'blob-upload')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('uploads binary content and returns 201 with nid, sha256, size, mime_type', async () => {
    const content = Buffer.from('hello world')
    const expectedSha256 = sha256hex(content)

    const res = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.nid).toBe('string')
    expect(body.sha256).toBe(expectedSha256)
    expect(body.size).toBe(content.byteLength)
    expect(typeof body.mime_type).toBe('string')
  })

  it('returns 400 when the provided sha256 query param does not match content (§14.3)', async () => {
    const content = Buffer.from('actual-content')

    const res = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}&sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })

    expect(res.statusCode).toBe(400)
  })

  it('accepts a custom mime_type query parameter', async () => {
    const content = Buffer.from('{"key":"value"}')

    const res = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}&mime_type=application%2Fjson`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().mime_type).toBe('application/json')
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}`,
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('x'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when fsid query parameter is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/blob',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: Buffer.from('x'),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /blob/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'blob-download')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns the raw binary content with application/octet-stream', async () => {
    const content = Buffer.from('binary content here')

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })
    const { nid } = uploadRes.json()

    const downloadRes = await app.inject({
      method: 'GET',
      url: `/blob/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(downloadRes.statusCode).toBe(200)
    expect(downloadRes.headers['content-type']).toMatch(/application\/octet-stream/)
    expect(Buffer.from(downloadRes.rawPayload)).toEqual(content)
  })

  it('returns 404 for unknown nid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/blob/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/blob/${crypto.randomUUID()}`,
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('HEAD /blob/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'blob-head')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with no body but includes Content-Length and X-SHA256 headers', async () => {
    const content = Buffer.from('head test content')

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })
    const { nid } = uploadRes.json()

    const headRes = await app.inject({
      method: 'HEAD',
      url: `/blob/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })

    expect(headRes.statusCode).toBe(200)
    expect(headRes.rawPayload.byteLength).toBe(0)
    expect(headRes.headers['content-length']).toBeDefined()
    expect(String(headRes.headers['content-length'])).toBe(String(content.byteLength))
    expect(headRes.headers['x-sha256']).toBeDefined()
    expect(headRes.headers['x-sha256']).toBe(sha256hex(content))
  })
})

describe('DELETE /blob/:nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'blob-delete')
    fsid = fs.fsid
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 204 when ref_count === 0 (§3.2, §9.3)', async () => {
    const content = Buffer.from('orphan blob')

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/blob?fsid=${fsid}`,
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${sessionId}`,
      },
      body: content,
    })
    const { nid } = uploadRes.json()

    // A freshly uploaded blob with no file nodes referencing it has ref_count=0
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/blob/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(delRes.statusCode).toBe(204)
  })

  it('returns 409 Conflict when ref_count > 0 (§9.3)', async () => {
    // Create a file that references the blob via op/create
    const res = await app.inject({
      method: 'POST',
      url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { path: '/ref-file.txt', type: 'file', content: 'data' },
    })
    expect(res.statusCode).toBe(201)
    const { nid: fileNid } = res.json()

    // Get the blob_nid from the file meta node
    const nodeRes = await app.inject({
      method: 'GET',
      url: `/node/${fileNid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const { blob_nid } = nodeRes.json()
    expect(blob_nid).not.toBeNull()

    // Deleting a blob with ref_count > 0 must fail with 409
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/blob/${blob_nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(delRes.statusCode).toBe(409)
  })

  it('returns 404 for unknown nid', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/blob/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/blob/${crypto.randomUUID()}`,
    })
    expect(res.statusCode).toBe(401)
  })
})
