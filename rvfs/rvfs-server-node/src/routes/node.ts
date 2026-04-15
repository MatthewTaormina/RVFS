import type { FastifyInstance } from 'fastify'
import type { StorageBackend, MetaNode } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession, assertFsAccess } from '../auth.js'

export function registerNodeRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.put('/node/:nid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { nid } = request.params as { nid: string }
    const node = request.body as MetaNode
    assertFsAccess(session, node.fsid, 'write')
    await storage.putMeta(node)
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
    const patch = request.body as Partial<MetaNode>
    const updated = await storage.patchMeta(nid, patch)
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
    const body = request.body as { ttl?: number | null }
    const updated = await storage.patchMeta(nid, { ttl: body.ttl ?? null } as Partial<MetaNode>)
    return reply.status(200).send(updated)
  })
}
