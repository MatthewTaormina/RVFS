import type { FastifyInstance } from 'fastify'
import type { StorageBackend, MetaNode, FileMetaNode } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession, assertFsAccess } from '../auth.js'
import { assertNodePermission } from '../permissions.js'
import { setNodeHeaders } from './headers.js'
import { validate, PatchNodeSchema, PatchNodeTtlSchema } from '../schemas.js'

export function registerNodeRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.put('/node/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const body = request.body as MetaNode

    // Q5: URL nid is authoritative — reject mismatched body nid
    if (body.nid && body.nid !== nid) {
      throw new RvfsError('EINVAL', 'Body nid does not match URL parameter', { status: 400 })
    }
    const node = { ...body, nid } as MetaNode

    assertFsAccess(session, node.fsid, 'write')
    assertNodePermission(session, node, 'write')
    await storage.putMeta(node)

    // B7: response headers
    const fs = await storage.getFS(node.fsid)
    if (fs) setNodeHeaders(reply, node, fs)

    return reply.status(200).send(node)
  })

  app.get('/node/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const node = await storage.getMeta(nid)
    if (!node) {
      throw new RvfsError('ENOENT', 'Node not found', { status: 404 })
    }
    assertFsAccess(session, node.fsid, 'read')

    // Q3: check read permission on the node
    assertNodePermission(session, node, 'read')

    // B7: response headers (ETag uses blob sha256 for file nodes)
    const fs = await storage.getFS(node.fsid)
    let blobSha256: string | null = null
    if (node.type === 'file') {
      const fileNode = node as FileMetaNode
      if (fileNode.blob_nid) {
        const blobHeader = await storage.getBlobHeader(fileNode.blob_nid)
        blobSha256 = blobHeader?.sha256 ?? null
      }
    }
    if (fs) setNodeHeaders(reply, node, fs, blobSha256)

    return reply.status(200).send(node)
  })

  app.patch('/node/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const existing = await storage.getMeta(nid)
    if (!existing) {
      throw new RvfsError('ENOENT', 'Node not found', { status: 404 })
    }
    assertFsAccess(session, existing.fsid, 'write')

    // Q3: check write permission on the node
    assertNodePermission(session, existing, 'write')

    const patch = validate(PatchNodeSchema, request.body) as Partial<MetaNode>
    const updated = await storage.patchMeta(nid, patch)

    // B7: response headers
    const fs = await storage.getFS(updated.fsid)
    if (fs) setNodeHeaders(reply, updated, fs)

    return reply.status(200).send(updated)
  })

  app.delete('/node/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const existing = await storage.getMeta(nid)
    if (!existing) {
      throw new RvfsError('ENOENT', 'Node not found', { status: 404 })
    }
    assertFsAccess(session, existing.fsid, 'write')

    // Q3: check write permission on the node
    assertNodePermission(session, existing, 'write')

    // B1: decrement blob ref_count before deleting file node
    if (existing.type === 'file') {
      const fileNode = existing as FileMetaNode
      if (fileNode.blob_nid) {
        const blobHeader = await storage.getBlobHeader(fileNode.blob_nid)
        if (blobHeader) {
          const newRefCount = blobHeader.ref_count - 1
          if (newRefCount <= 0) {
            await storage.deleteBlob(fileNode.blob_nid)
          } else {
            const blob = await storage.getBlob(fileNode.blob_nid)
            await storage.putBlob(
              { ...blobHeader, ref_count: newRefCount },
              blob ?? new ArrayBuffer(0),
            )
          }
        }
      }
    }

    await storage.deleteMeta(nid)
    return reply.status(204).send()
  })

  app.patch('/node/:nid/ttl', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const existing = await storage.getMeta(nid)
    if (!existing) {
      throw new RvfsError('ENOENT', 'Node not found', { status: 404 })
    }
    assertFsAccess(session, existing.fsid, 'write')

    // Q3: check write permission on the node
    assertNodePermission(session, existing, 'write')

    const body = validate(PatchNodeTtlSchema, request.body)
    const updated = await storage.patchMeta(nid, { ttl: body.ttl ?? null } as Partial<MetaNode>)

    // B7: response headers
    const fs = await storage.getFS(updated.fsid)
    if (fs) setNodeHeaders(reply, updated, fs)

    return reply.status(200).send(updated)
  })
}
