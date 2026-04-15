import type { FastifyInstance } from 'fastify'
import type { StorageBackend, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession } from '../auth.js'
import { MemoryStorageBackend } from '../storage/memory.js'

export function registerSessionRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.post('/session', async (request, reply) => {
    const body = request.body as {
      identity?: string
      ttl_seconds?: number
      filesystems?: Array<{ fsid: string; access: string }>
      metadata?: Record<string, unknown>
    }

    if (!body.identity || typeof body.ttl_seconds !== 'number') {
      throw new RvfsError('EINVAL', 'Missing required fields: identity, ttl_seconds', { status: 400 })
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + body.ttl_seconds * 1000)
    const session: Session = {
      session_id: crypto.randomUUID(),
      identity: body.identity,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ttl_seconds: body.ttl_seconds,
      filesystems: (body.filesystems ?? []) as Session['filesystems'],
      metadata: body.metadata ?? {},
    }

    await storage.putSession(session)
    return reply.status(201).send(session)
  })

  app.get('/session/:session_id', async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new RvfsError('FORBIDDEN', 'Missing or invalid Authorization header', { status: 401 })
    }
    const token = authHeader.slice(7)
    const { session_id } = request.params as { session_id: string }

    // If the token was revoked, return 401
    if (storage instanceof MemoryStorageBackend && storage.isRevoked(token)) {
      throw new RvfsError('FORBIDDEN', 'Session revoked', { status: 401 })
    }

    const session = await storage.getSession(session_id)
    if (!session) {
      throw new RvfsError('ENOENT', 'Session not found', { status: 404 })
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new RvfsError('FORBIDDEN', 'Session expired', { status: 401 })
    }
    return reply.status(200).send(session)
  })

  app.delete('/session/:session_id', async (request, reply) => {
    await validateSession(request, storage)
    const { session_id } = request.params as { session_id: string }
    await storage.deleteSession(session_id)
    return reply.status(204).send()
  })

  app.patch('/session/:session_id/ttl', async (request, reply) => {
    const callerSession = await validateSession(request, storage)
    const { session_id } = request.params as { session_id: string }
    const body = request.body as { ttl_seconds?: number }

    if (typeof body.ttl_seconds !== 'number') {
      throw new RvfsError('EINVAL', 'Missing ttl_seconds', { status: 400 })
    }

    const session = await storage.getSession(session_id)
    if (!session) {
      throw new RvfsError('ENOENT', 'Session not found', { status: 404 })
    }

    const newExpiresAt = new Date(Date.now() + body.ttl_seconds * 1000)
    const updated: Session = {
      ...session,
      expires_at: newExpiresAt.toISOString(),
      ttl_seconds: body.ttl_seconds,
    }
    await storage.putSession(updated)
    return reply.status(200).send(updated)
  })
}
