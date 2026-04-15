import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { EventEmitter } from 'node:events'
import type { StorageBackend } from 'rvfs-types'
import { RvfsError } from './errors.js'
import { registerPingRoutes } from './routes/ping.js'
import { registerSessionRoutes } from './routes/session.js'
import { registerFsRoutes } from './routes/fs.js'
import { registerNodeRoutes } from './routes/node.js'
import { registerBlobRoutes } from './routes/blob.js'
import { registerBatchRoutes } from './routes/batch.js'
import { registerWatchRoutes } from './routes/watch.js'

export interface RvfsServerConfig {
  storage: StorageBackend
}

export function createServer(config: RvfsServerConfig): FastifyInstance {
  const { storage } = config
  const emitter = new EventEmitter()
  emitter.setMaxListeners(1000)

  // Q4: per-session sliding window rate limiter (§14.9)
  // Map key = bearer token; scoped to server instance so tests are isolated
  const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
  const RATE_LIMIT_MAX = 1000
  const RATE_WINDOW_MS = 60_000

  const app = Fastify({ logger: false })

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  // Q4: rate limiting hook — apply to all routes except /ping and internal batch sub-requests
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/ping') return
    if (request.headers['x-rvfs-internal'] === 'batch') return // W7: skip for batch sub-requests
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return // unauthenticated → fail at auth layer
    const token = authHeader.slice(7)
    const now = Date.now()
    let entry = rateLimitMap.get(token)
    if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
      entry = { count: 0, windowStart: now }
    }
    entry.count++
    rateLimitMap.set(token, entry)
    if (entry.count > RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000)
      void reply.header('retry-after', String(retryAfter))
      throw new RvfsError('TIMEOUT', 'Rate limit exceeded', { status: 429 })
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RvfsError) {
      return reply.status(error.status ?? 500).send({
        error: error.code,
        message: error.message,
        ...(error.path != null ? { path: error.path } : {}),
        ...(error.nid != null ? { nid: error.nid } : {}),
      })
    }
    if (error.validation) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', details: error.validation })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'REQUEST_ERROR', message: error.message })
    }
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' })
  })

  registerPingRoutes(app)
  registerSessionRoutes(app, storage)
  registerFsRoutes(app, storage, emitter)
  registerNodeRoutes(app, storage)
  registerBlobRoutes(app, storage)
  registerBatchRoutes(app, storage)
  registerWatchRoutes(app, storage, emitter)

  app.post('/lock', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'file-locking', since: 'v2' })
  })
  app.delete('/lock/:lockId', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'file-locking', since: 'v2' })
  })
  // Q6: missing lock stubs — §15
  app.get('/lock/:lockId', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'locking', since: 'v2' })
  })
  app.post('/lock/:lockId/heartbeat', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'locking', since: 'v2' })
  })
  app.get('/fs/:fsid/locks', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'locking', since: 'v2' })
  })
  app.post('/presign', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'presigned-links', since: 'v2' })
  })
  app.get('/presigned/:token', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'presigned-links', since: 'v2' })
  })

  return app
}
