import type { FastifyInstance } from 'fastify'

const VERSION = '0.1.0'

export function registerPingRoutes(app: FastifyInstance): void {
  app.get('/ping', async (_request, reply) => {
    return reply.status(200).send({ ok: true, version: VERSION })
  })
}
