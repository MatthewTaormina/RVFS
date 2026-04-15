import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { StorageBackend, BlobHeader } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession, assertFsAccess } from '../auth.js'

export function registerBlobRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.post('/blob', async (request, reply) => {
    const session = await validateSession(request, storage)
    const query = request.query as { fsid?: string; sha256?: string; mime_type?: string }

    if (!query.fsid) {
      throw new RvfsError('EINVAL', 'Missing fsid query parameter', { status: 400 })
    }

    const root = await storage.getFS(query.fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, query.fsid, 'write')

    const body = request.body as Buffer
    const contentBuf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const actualSha256 = createHash('sha256').update(contentBuf).digest('hex')

    if (query.sha256 && query.sha256 !== actualSha256) {
      throw new RvfsError('EINVAL', 'SHA-256 mismatch', { status: 400 })
    }

    const now = new Date().toISOString()
    const header: BlobHeader = {
      nid: 'n-' + crypto.randomUUID(),
      type: 'blob',
      fsid: query.fsid,
      size: contentBuf.byteLength,
      mime_type: query.mime_type ?? 'application/octet-stream',
      sha256: actualSha256,
      created_at: now,
      ttl: null,
      ref_count: 0,
    }

    const ab = contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.byteLength)
    await storage.putBlob(header, ab)

    return reply.status(201).send({
      nid: header.nid,
      sha256: header.sha256,
      size: header.size,
      mime_type: header.mime_type,
    })
  })

  app.get('/blob/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const header = await storage.getBlobHeader(nid)
    if (!header) {
      throw new RvfsError('ENOENT', 'Blob not found', { status: 404 })
    }
    assertFsAccess(session, header.fsid, 'read')
    const content = await storage.getBlob(nid)
    if (!content) {
      throw new RvfsError('ENOENT', 'Blob content not found', { status: 404 })
    }
    return reply
      .status(200)
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(header.size))
      .header('x-sha256', header.sha256)
      .send(Buffer.from(content))
  })

  app.route({
    method: 'HEAD',
    url: '/blob/:nid',
    handler: async (request, reply) => {
      const session = await validateSession(request, storage)
      const { nid } = request.params as { nid: string }
      const header = await storage.getBlobHeader(nid)
      if (!header) {
        throw new RvfsError('ENOENT', 'Blob not found', { status: 404 })
      }
      assertFsAccess(session, header.fsid, 'read')
      return reply
        .status(200)
        .header('content-type', 'application/octet-stream')
        .header('content-length', String(header.size))
        .header('x-sha256', header.sha256)
        .send()
    },
  })

  app.delete('/blob/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const header = await storage.getBlobHeader(nid)
    if (!header) {
      throw new RvfsError('ENOENT', 'Blob not found', { status: 404 })
    }
    assertFsAccess(session, header.fsid, 'write')
    if (header.ref_count > 0) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'Blob is still referenced' })
    }
    await storage.deleteBlob(nid)
    return reply.status(204).send()
  })
}
