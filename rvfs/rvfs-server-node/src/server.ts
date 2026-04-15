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

  const app = Fastify({ logger: false })

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

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
  app.post('/presign', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'presigned-links', since: 'v2' })
  })
  app.get('/presigned/:token', async (_req, reply) => {
    reply.status(501).send({ error: 'NOT_IMPLEMENTED', feature: 'presigned-links', since: 'v2' })
  })

  return app
}
