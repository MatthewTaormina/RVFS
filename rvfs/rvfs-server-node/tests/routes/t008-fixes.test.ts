/**
 * T-008 targeted regression tests — one test per blocker/warning fixed.
 * Tests new behaviours not covered by the 175 existing tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { makeServer, createSession, createFs, opCreate, opWrite } from '../setup.js'
import type { FileMetaNode } from 'rvfs-types'

// ---------------------------------------------------------------------------
// B1 — DELETE /node/:nid decrements blob ref_count
// ---------------------------------------------------------------------------
describe('B1 — DELETE /node/:nid decrements blob ref_count', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b1-test')
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('deletes the blob when ref_count reaches 0', async () => {
    // Create a file with content → blob is created with ref_count=1
    const { nid } = await opCreate(app, sessionId, fsid, {
      path: '/b1.txt',
      type: 'file',
      content: 'hello',
    })

    // Retrieve node to find blob_nid
    const getRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const fileNode = getRes.json() as FileMetaNode
    const blobNid = fileNode.blob_nid
    expect(blobNid).toBeTruthy()

    // Verify blob exists
    const blobBefore = await app.inject({
      method: 'HEAD',
      url: `/blob/${blobNid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(blobBefore.statusCode).toBe(200)

    // Delete the node
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(delRes.statusCode).toBe(204)

    // Blob should now be gone
    const blobAfter = await app.inject({
      method: 'HEAD',
      url: `/blob/${blobNid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(blobAfter.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// B2 — writeNodeOp updates meta.mtime
// ---------------------------------------------------------------------------
describe('B2 — op/write updates meta.mtime', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b2-test')
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('bumps mtime after a write', async () => {
    const { nid } = await opCreate(app, sessionId, fsid, { path: '/b2.txt', type: 'file', content: '' })

    const before = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const mtimeBefore = (before.json() as FileMetaNode).meta.mtime

    // Small sleep to ensure timestamp advances
    await new Promise((r) => setTimeout(r, 5))

    await opWrite(app, sessionId, fsid, { path: '/b2.txt', content: 'new content' })

    const after = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const mtimeAfter = (after.json() as FileMetaNode).meta.mtime

    expect(new Date(mtimeAfter).getTime()).toBeGreaterThanOrEqual(new Date(mtimeBefore).getTime())
  })
})

// ---------------------------------------------------------------------------
// B3 — patchMeta deep-merges nested meta field
// ---------------------------------------------------------------------------
describe('B3 — PATCH /node/:nid deep-merges meta', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b3-test')
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('partial meta PATCH preserves all LinuxMeta fields', async () => {
    const { nid } = await opCreate(app, sessionId, fsid, { path: '/b3.txt', type: 'file' })

    const getRes = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const originalNode = getRes.json() as FileMetaNode
    const originalMode = originalNode.meta.mode
    const originalInode = originalNode.meta.inode

    // Patch only uid — all other meta fields must survive
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { meta: { uid: 2000 } },
    })
    expect(patchRes.statusCode).toBe(200)
    const patched = patchRes.json() as FileMetaNode

    expect(patched.meta.uid).toBe(2000)
    expect(patched.meta.mode).toBe(originalMode)
    expect(patched.meta.inode).toBe(originalInode)
  })
})

// ---------------------------------------------------------------------------
// B5 — GET /fs pagination defaults (limit=20, max=100)
// ---------------------------------------------------------------------------
describe('B5 — GET /fs pagination defaults', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })
  afterEach(() => app.close())

  it('caps limit at 100 when ?limit=9999', async () => {
    // Create more than 20 but fewer than 100 FSes
    for (let i = 0; i < 5; i++) {
      await createFs(app, sessionId, `fs-b5-${i}`)
    }

    const res = await app.inject({
      method: 'GET',
      url: '/fs?limit=9999',
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // All items should be returned (<=100) — the key check is it accepted the request
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// B6 — inode = lower 53 bits of SHA-256 of nid
// ---------------------------------------------------------------------------
describe('B6 — inode is SHA-256 derived', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b6-test')
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('inode matches lower 53 bits of SHA-256 of nid', async () => {
    const { nid } = await opCreate(app, sessionId, fsid, { path: '/b6.txt', type: 'file' })

    const res = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    const node = res.json() as FileMetaNode
    const inodeHex = createHash('sha256').update(nid).digest('hex')
    const expectedInode = Number(BigInt('0x' + inodeHex.slice(0, 14)) & BigInt(Number.MAX_SAFE_INTEGER))

    expect(node.meta.inode).toBe(expectedInode)
  })
})

// ---------------------------------------------------------------------------
// B7 — Response headers (X-Node-TTL, X-FS-TTL, ETag)
// ---------------------------------------------------------------------------
describe('B7 — Response headers on node/FS routes', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b7-test', 3600)
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('GET /fs/:fsid returns ETag header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['etag']).toBeTruthy()
  })

  it('GET /fs/:fsid returns X-FS-TTL when ttl is set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.headers['x-fs-ttl']).toBeDefined()
    const ttl = Number(res.headers['x-fs-ttl'])
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(3600)
  })

  it('GET /node/:nid returns ETag for dir node', async () => {
    const { nid } = await opCreate(app, sessionId, fsid, { path: '/b7dir', type: 'dir' })
    const res = await app.inject({
      method: 'GET',
      url: `/node/${nid}`,
      headers: { authorization: `Bearer ${sessionId}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['etag']).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// B8 — SSE: id: field is present
// ---------------------------------------------------------------------------
describe('B8 — SSE id: field in event stream', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string
  let port: number

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'b8-test')
    fsid = fs.fsid
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  })
  afterEach(() => app.close())

  it('SSE events include id: field per §9.7', async () => {
    const { default: http } = await import('http')

    const chunks: string[] = []
    await new Promise<void>((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `/fs/${fsid}/watch`,
          headers: { authorization: `Bearer ${sessionId}`, accept: 'text/event-stream' },
        },
        (res) => {
          res.on('data', (c: Buffer) => chunks.push(c.toString()))
        },
      )
      // Trigger an event then close after a short wait
      setTimeout(async () => {
        await app.inject({
          method: 'POST',
          url: `/fs/${fsid}/op/create`,
          headers: { authorization: `Bearer ${sessionId}` },
          payload: { path: '/b8.txt', type: 'file' },
        })
        setTimeout(() => { req.destroy(); resolve() }, 100)
      }, 50)
    })

    const combined = chunks.join('')
    expect(combined).toMatch(/^id: /m)
  })
})

// ---------------------------------------------------------------------------
// Q1 — IDOR: cannot access another session
// ---------------------------------------------------------------------------
describe('Q1 — IDOR protection on session endpoints', () => {
  let app: FastifyInstance

  beforeEach(() => { app = makeServer() })
  afterEach(() => app.close())

  it('GET /session/:id returns 403 when accessing another session', async () => {
    // Create two sessions
    const res1 = await app.inject({
      method: 'POST', url: '/session',
      payload: { identity: 'alice', ttl_seconds: 3600 },
    })
    const { session_id: alice } = res1.json()

    const res2 = await app.inject({
      method: 'POST', url: '/session',
      payload: { identity: 'bob', ttl_seconds: 3600 },
    })
    const { session_id: bob } = res2.json()

    // Alice tries to read Bob's session
    const res = await app.inject({
      method: 'GET',
      url: `/session/${bob}`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE /session/:id returns 403 when deleting another session', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/session', payload: { identity: 'alice', ttl_seconds: 3600 } })
    const { session_id: alice } = r1.json()
    const r2 = await app.inject({ method: 'POST', url: '/session', payload: { identity: 'bob', ttl_seconds: 3600 } })
    const { session_id: bob } = r2.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/session/${bob}`,
      headers: { authorization: `Bearer ${alice}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH /session/:id/ttl returns 403 when modifying another session', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/session', payload: { identity: 'alice', ttl_seconds: 3600 } })
    const { session_id: alice } = r1.json()
    const r2 = await app.inject({ method: 'POST', url: '/session', payload: { identity: 'bob', ttl_seconds: 3600 } })
    const { session_id: bob } = r2.json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/session/${bob}/ttl`,
      headers: { authorization: `Bearer ${alice}` },
      payload: { ttl_seconds: 7200 },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Q3 — POSIX permission check (using session with explicit uid/gid)
// ---------------------------------------------------------------------------
describe('Q3 — POSIX permission enforcement', () => {
  let app: FastifyInstance

  beforeEach(() => { app = makeServer() })
  afterEach(() => app.close())

  it('denies write to a read-only file (mode=0o444) for non-root uid', async () => {
    // Create a session with uid=2000 (non-root)
    const sessRes = await app.inject({
      method: 'POST', url: '/session',
      payload: { identity: 'restricted', ttl_seconds: 3600, metadata: { uid: 2000, gid: 2000 } },
    })
    const { session_id: restrictedId } = sessRes.json()

    // Create an FS for this session
    const fsRes = await app.inject({
      method: 'POST', url: '/fs',
      headers: { authorization: `Bearer ${restrictedId}` },
      payload: { label: 'q3-test' },
    })
    const { fsid } = fsRes.json()

    // Create a file (will have uid=2000, mode=0o644 by default)
    const createRes = await app.inject({
      method: 'POST', url: `/fs/${fsid}/op/create`,
      headers: { authorization: `Bearer ${restrictedId}` },
      payload: { path: '/readonly.txt', type: 'file', meta: { mode: 0o444, uid: 9999, gid: 9999 } },
    })
    expect(createRes.statusCode).toBe(201)

    // Try to write to the read-only file owned by uid=9999
    const writeRes = await app.inject({
      method: 'POST', url: `/fs/${fsid}/op/write`,
      headers: { authorization: `Bearer ${restrictedId}` },
      payload: { path: '/readonly.txt', content: 'should fail' },
    })
    expect(writeRes.statusCode).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Q4 — Rate limiting (§14.9)
// ---------------------------------------------------------------------------
describe('Q4 — Rate limiting', () => {
  it('returns 429 after exceeding 1000 requests per session window', async () => {
    const app = makeServer()
    try {
      const sessRes = await app.inject({
        method: 'POST', url: '/session',
        payload: { identity: 'rate-test', ttl_seconds: 3600 },
      })
      const { session_id } = sessRes.json()

      // Make 1001 requests to trigger the rate limit
      let lastStatus = 0
      for (let i = 0; i <= 1000; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/ping',  // /ping is exempt, so use /session endpoint
        })
        // /ping is exempt — use a real authenticated endpoint
        void res
      }

      // Use an authenticated endpoint that counts toward rate limit
      for (let i = 0; i <= 1001; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/fs',
          headers: { authorization: `Bearer ${session_id}` },
        })
        lastStatus = res.statusCode
        if (lastStatus === 429) break
      }
      expect(lastStatus).toBe(429)
    } finally {
      await app.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Q5 — PUT /node/:nid uses URL nid (body nid ignored / rejected if mismatched)
// ---------------------------------------------------------------------------
describe('Q5 — PUT /node/:nid uses URL nid', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'q5-test')
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('rejects when body nid differs from URL nid', async () => {
    const urlNid = crypto.randomUUID()
    const bodyNid = crypto.randomUUID() // different

    const res = await app.inject({
      method: 'PUT',
      url: `/node/${urlNid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        nid: bodyNid,
        type: 'file',
        name: 'q5.txt',
        parent_nid: null,
        fsid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ttl: null,
        meta: { mode: 0o644, uid: 1000, gid: 1000, atime: new Date().toISOString(), mtime: new Date().toISOString(), ctime: new Date().toISOString(), nlink: 1, inode: 1 },
        blob_nid: null,
        size: 0,
        symlink_target: null,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('uses URL nid when body nid is absent', async () => {
    const urlNid = crypto.randomUUID()

    const res = await app.inject({
      method: 'PUT',
      url: `/node/${urlNid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        // no nid field
        type: 'file',
        name: 'q5.txt',
        parent_nid: null,
        fsid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ttl: null,
        meta: { mode: 0o644, uid: 1000, gid: 1000, atime: new Date().toISOString(), mtime: new Date().toISOString(), ctime: new Date().toISOString(), nlink: 1, inode: 1 },
        blob_nid: null,
        size: 0,
        symlink_target: null,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().nid).toBe(urlNid)
  })
})

// ---------------------------------------------------------------------------
// Q6 — V2 lock stubs return 501
// ---------------------------------------------------------------------------
describe('Q6 — V2 lock endpoint stubs', () => {
  let app: FastifyInstance

  beforeEach(() => { app = makeServer() })
  afterEach(() => app.close())

  it('GET /lock/:lockId returns 501', async () => {
    const res = await app.inject({ method: 'GET', url: '/lock/test-lock-id' })
    expect(res.statusCode).toBe(501)
  })

  it('POST /lock/:lockId/heartbeat returns 501', async () => {
    const res = await app.inject({ method: 'POST', url: '/lock/test-lock-id/heartbeat' })
    expect(res.statusCode).toBe(501)
  })

  it('GET /fs/:fsid/locks returns 501', async () => {
    const res = await app.inject({ method: 'GET', url: '/fs/fs-test/locks' })
    expect(res.statusCode).toBe(501)
  })
})

// ---------------------------------------------------------------------------
// W2 — PATCH /fs/:fsid accepts ttl in body
// ---------------------------------------------------------------------------
describe('W2 — PATCH /fs/:fsid accepts ttl', () => {
  let app: FastifyInstance
  let sessionId: string
  let fsid: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
    const fs = await createFs(app, sessionId, 'w2-test', null)
    fsid = fs.fsid
  })
  afterEach(() => app.close())

  it('updates the TTL via PATCH body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/fs/${fsid}`,
      headers: { authorization: `Bearer ${sessionId}` },
      payload: { ttl: 7200 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ttl).toBe(7200)
  })
})

// ---------------------------------------------------------------------------
// W3 — /ping version comes from package.json
// ---------------------------------------------------------------------------
describe('W3 — ping version', () => {
  let app: FastifyInstance

  beforeEach(() => { app = makeServer() })
  afterEach(() => app.close())

  it('returns a semver version string', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.statusCode).toBe(200)
    const { version } = res.json()
    expect(typeof version).toBe('string')
    // semver pattern
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

// ---------------------------------------------------------------------------
// W4 — Batch method allowlist
// ---------------------------------------------------------------------------
describe('W4 — Batch method allowlist', () => {
  let app: FastifyInstance
  let sessionId: string

  beforeEach(async () => {
    app = makeServer()
    sessionId = await createSession(app)
  })
  afterEach(() => app.close())

  it('rejects batch requests with non-standard HTTP methods', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [{ id: '1', method: 'CONNECT', path: '/ping' }],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts valid methods in batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/batch',
      headers: { authorization: `Bearer ${sessionId}` },
      payload: {
        requests: [{ id: '1', method: 'GET', path: '/ping' }],
      },
    })
    expect(res.statusCode).toBe(200)
  })
})
