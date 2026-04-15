import type { FastifyInstance } from 'fastify'
import type { StorageBackend, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession } from '../auth.js'
import { validate, CreateSessionSchema, PatchSessionTtlSchema } from '../schemas.js'

export function registerSessionRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.post('/session', async (request, reply) => {
    const body = validate(CreateSessionSchema, request.body)

    // B7: cap guest session TTL at 24 hours
    let ttlSeconds = body.ttl_seconds
    if (body.identity === 'guest') {
      ttlSeconds = Math.min(ttlSeconds, 86400)
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
    const session: Session = {
      session_id: crypto.randomUUID(),
      identity: body.identity,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      ttl_seconds: ttlSeconds,
      filesystems: (body.filesystems ?? []) as Session['filesystems'],
      metadata: body.metadata ?? {},
    }

    await storage.putSession(session)
    return reply.status(201).send(session)
  })

  app.get('/session/:session_id', async (request, reply) => {
    // Q2: validate caller's bearer token first
    const callerSession = await validateSession(request, storage)
    const { session_id } = request.params as { session_id: string }

    const targetSession = await storage.getSession(session_id)
    if (!targetSession) {
      throw new RvfsError('ENOENT', 'Session not found', { status: 404 })
    }

    // Q1: IDOR — a session may only read its own record
    if (targetSession.session_id !== callerSession.session_id) {
      throw new RvfsError('EACCES', 'Access denied: cannot access another session', { status: 403 })
    }

    return reply.status(200).send(targetSession)
  })

  app.delete('/session/:session_id', async (request, reply) => {
    const callerSession = await validateSession(request, storage)
    const { session_id } = request.params as { session_id: string }

    const targetSession = await storage.getSession(session_id)
    if (!targetSession) {
      throw new RvfsError('ENOENT', 'Session not found', { status: 404 })
    }

    // Q1: IDOR — a session may only delete its own record
    if (targetSession.session_id !== callerSession.session_id) {
      throw new RvfsError('EACCES', 'Access denied: cannot delete another session', { status: 403 })
    }

    await storage.deleteSession(session_id)
    return reply.status(204).send()
  })

  app.patch('/session/:session_id/ttl', async (request, reply) => {
    const callerSession = await validateSession(request, storage)
    const { session_id } = request.params as { session_id: string }
    const body = validate(PatchSessionTtlSchema, request.body)

    if (typeof body.ttl_seconds !== 'number') {
      throw new RvfsError('EINVAL', 'Missing ttl_seconds', { status: 400 })
    }

    const targetSession = await storage.getSession(session_id)
    if (!targetSession) {
      throw new RvfsError('ENOENT', 'Session not found', { status: 404 })
    }

    // Q1: IDOR — a session may only extend its own TTL
    if (targetSession.session_id !== callerSession.session_id) {
      throw new RvfsError('EACCES', 'Access denied: cannot modify another session', { status: 403 })
    }

    const newExpiresAt = new Date(Date.now() + body.ttl_seconds * 1000)
    const updated: Session = {
      ...targetSession,
      expires_at: newExpiresAt.toISOString(),
      ttl_seconds: body.ttl_seconds,
    }
    await storage.putSession(updated)
    return reply.status(200).send(updated)
  })
}
