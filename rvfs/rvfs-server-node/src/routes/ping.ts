import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const _pkgDir = dirname(fileURLToPath(import.meta.url))
const _pkg = JSON.parse(readFileSync(join(_pkgDir, '../../package.json'), 'utf-8')) as { version: string }
const VERSION = _pkg.version

export function registerPingRoutes(app: FastifyInstance): void {
  app.get('/ping', async (_request, reply) => {
    return reply.status(200).send({ ok: true, version: VERSION })
  })
}
