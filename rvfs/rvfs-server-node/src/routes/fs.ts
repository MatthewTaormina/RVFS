import type { FastifyInstance } from 'fastify'
import type { EventEmitter } from 'node:events'
import type { StorageBackend, RootMetaNode, RvfsChangeEvent } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession, assertFsAccess } from '../auth.js'
import { createNodeOp, canonicalizePath, resolvePath } from '../ops/create.js'
import { writeNodeOp, readNodeOp } from '../ops/write.js'
import { rmNodeOp } from '../ops/rm.js'
import { mvNodeOp } from '../ops/mv.js'
import { cpNodeOp } from '../ops/cp.js'
import { bufferEvent } from './watch.js'

function emitChange(
  emitter: EventEmitter,
  fsid: string,
  event: Omit<RvfsChangeEvent, 'event_id' | 'at'>,
): void {
  const payload: RvfsChangeEvent = {
    event_id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...event,
  }
  bufferEvent(fsid, payload)
  emitter.emit(`${fsid}:change`, payload)
}

export function registerFsRoutes(
  app: FastifyInstance,
  storage: StorageBackend,
  emitter: EventEmitter,
): void {
  app.get('/fs', async (request, reply) => {
    const session = await validateSession(request, storage)
    const query = request.query as { limit?: string; cursor?: string }
    const limit = query.limit ? Math.min(parseInt(query.limit, 10), 1000) : 100

    const items: Array<{
      fsid: string
      label: string
      owner: string
      access: string
      created_at: string
      ttl: number | null
    }> = []

    for (const entry of session.filesystems) {
      const root = await storage.getFS(entry.fsid)
      if (!root) continue
      items.push({
        fsid: root.fsid,
        label: root.label,
        owner: root.owner,
        access: entry.access,
        created_at: root.created_at,
        ttl: root.ttl,
      })
    }

    const start = query.cursor ? items.findIndex((i) => i.fsid === query.cursor) + 1 : 0
    const page = items.slice(start, start + limit)
    const nextCursor = start + limit < items.length ? items[start + limit - 1]?.fsid ?? null : null

    return reply.status(200).send({
      items: page,
      cursor: nextCursor,
      has_more: start + limit < items.length,
    })
  })

  app.post('/fs', async (request, reply) => {
    const session = await validateSession(request, storage)
    const body = request.body as { label?: string; ttl?: number | null; owner?: string }

    const now = new Date().toISOString()
    const fsid = 'fs-' + crypto.randomUUID()
    const rootNid = 'n-' + crypto.randomUUID()

    const root: RootMetaNode = {
      nid: rootNid,
      type: 'root',
      fsid,
      label: body.label ?? 'untitled',
      created_at: now,
      updated_at: now,
      ttl: body.ttl ?? null,
      owner: body.owner ?? session.identity,
      fork_of: null,
      fork_depth: 0,
      children: [],
      name_index: {},
    }

    await storage.putFS(root)

    const updatedSession = {
      ...session,
      filesystems: [...session.filesystems, { fsid, access: 'admin' as const }],
    }
    await storage.putSession(updatedSession)

    return reply.status(201).send({
      fsid,
      root_nid: rootNid,
      label: root.label,
      created_at: root.created_at,
    })
  })

  app.get('/fs/:fsid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'read')
    return reply.status(200).send(root)
  })

  app.patch('/fs/:fsid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'write')
    const body = request.body as { label?: string }
    const updated: RootMetaNode = {
      ...root,
      label: body.label ?? root.label,
      updated_at: new Date().toISOString(),
    }
    await storage.putFS(updated)
    return reply.status(200).send(updated)
  })

  app.delete('/fs/:fsid', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'admin')
    await storage.deleteFS(fsid)
    emitChange(emitter, fsid, {
      event: 'fs:delete',
      fsid,
      nid: null,
      path: null,
      old_path: null,
      session_id: session.session_id,
      meta_delta: null,
    })
    return reply.status(204).send()
  })

  app.post('/fs/:fsid/fork', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid: parentFsid } = request.params as { fsid: string }
    const parent = await storage.getFS(parentFsid)
    if (!parent) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, parentFsid, 'read')

    if (parent.fork_depth >= 1) {
      return reply.status(400).send({ error: 'FORK_DEPTH_EXCEEDED', message: 'V1 fork depth limited to 1' })
    }

    const body = request.body as { label?: string; ttl?: number | null; owner?: string }
    const now = new Date().toISOString()
    const newFsid = 'fs-' + crypto.randomUUID()
    const rootNid = 'n-' + crypto.randomUUID()

    const forkRoot: RootMetaNode = {
      nid: rootNid,
      type: 'root',
      fsid: newFsid,
      label: body.label ?? parent.label + '-fork',
      created_at: now,
      updated_at: now,
      ttl: body.ttl ?? null,
      owner: body.owner ?? session.identity,
      fork_of: parentFsid,
      fork_depth: 1,
      children: [...parent.children],
      name_index: { ...parent.name_index },
    }

    await storage.putFS(forkRoot)

    const updatedSession = {
      ...session,
      filesystems: [...session.filesystems, { fsid: newFsid, access: 'admin' as const }],
    }
    await storage.putSession(updatedSession)

    emitChange(emitter, parentFsid, {
      event: 'fs:fork',
      fsid: parentFsid,
      nid: null,
      path: null,
      old_path: null,
      session_id: session.session_id,
      meta_delta: null,
    })

    return reply.status(201).send({
      fsid: newFsid,
      root_nid: rootNid,
      fork_of: parentFsid,
      fork_depth: 1,
    })
  })

  app.get('/fs/:fsid/nodes', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'read')
    const query = request.query as { cursor?: string; limit?: string }
    const limit = query.limit ? parseInt(query.limit, 10) : 100
    const result = await storage.listFSNodes(fsid, query.cursor, limit)
    return reply.status(200).send({ nids: result.nids, cursor: result.cursor, has_more: result.cursor !== null })
  })

  app.patch('/fs/:fsid/ttl', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'write')
    const body = request.body as { ttl?: number | null }
    const updated: RootMetaNode = { ...root, ttl: body.ttl ?? null, updated_at: new Date().toISOString() }
    await storage.putFS(updated)
    return reply.status(200).send(updated)
  })

  app.post('/fs/:fsid/op/create', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'write')

    const body = request.body as {
      path: string
      type: 'file' | 'dir' | 'symlink'
      content?: string
      meta?: { mode?: number; uid?: number; gid?: number }
      symlink_target?: string
    }

    const result = await createNodeOp(storage, session, fsid, body)

    emitChange(emitter, fsid, {
      event: 'node:create',
      fsid,
      nid: result.nid,
      path: result.path,
      old_path: null,
      session_id: session.session_id,
      meta_delta: null,
    })

    return reply.status(201).send(result)
  })

  app.post('/fs/:fsid/op/read', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'read')

    const body = request.body as { path: string }
    const result = await readNodeOp(storage, session, fsid, body)
    return reply.status(200).send(result)
  })

  app.post('/fs/:fsid/op/write', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'write')

    const body = request.body as {
      path: string
      content: string
      create_if_missing?: boolean
      append?: boolean
    }

    const resolvedPath = canonicalizePath(body.path)
    const nodeBeforeWrite = await resolvePath(storage, fsid, resolvedPath)

    await writeNodeOp(storage, session, fsid, body)

    const nodeAfterWrite = await resolvePath(storage, fsid, resolvedPath)
    const nid = nodeAfterWrite?.nid ?? nodeBeforeWrite?.nid ?? null

    emitChange(emitter, fsid, {
      event: 'node:write',
      fsid,
      nid,
      path: resolvedPath,
      old_path: null,
      session_id: session.session_id,
      meta_delta: null,
    })

    return reply.status(200).send({})
  })

  app.post('/fs/:fsid/op/rm', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'write')

    const body = request.body as { path: string; recursive?: boolean }
    const node = await resolvePath(storage, fsid, canonicalizePath(body.path))
    const nid = node?.nid ?? null

    await rmNodeOp(storage, session, fsid, body)

    emitChange(emitter, fsid, {
      event: 'node:delete',
      fsid,
      nid,
      path: body.path,
      old_path: null,
      session_id: session.session_id,
      meta_delta: null,
    })

    return reply.status(200).send({})
  })

  app.post('/fs/:fsid/op/mv', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'write')

    const body = request.body as { src: string; dst: string }
    const srcNode = await resolvePath(storage, fsid, canonicalizePath(body.src))

    await mvNodeOp(storage, session, fsid, body)

    emitChange(emitter, fsid, {
      event: 'node:move',
      fsid,
      nid: srcNode?.nid ?? null,
      path: body.dst,
      old_path: body.src,
      session_id: session.session_id,
      meta_delta: null,
    })

    return reply.status(200).send({})
  })

  app.post('/fs/:fsid/op/cp', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }
    const root = await storage.getFS(fsid)
    if (!root) throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    assertFsAccess(session, fsid, 'write')

    const body = request.body as { src: string; dst: string; recursive?: boolean }
    await cpNodeOp(storage, session, fsid, body)

    return reply.status(200).send({})
  })
}
