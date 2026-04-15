import type { FastifyInstance } from 'fastify'
import type { StorageBackend } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession } from '../auth.js'

interface BatchRequest {
  id: string
  method: string
  path: string
  body?: unknown
}

interface BatchResponse {
  id: string
  status: number
  body: unknown
}

export function registerBatchRoutes(app: FastifyInstance, storage: StorageBackend): void {
  app.post('/batch', async (request, reply) => {
    await validateSession(request, storage)

    const bodyRaw = request.body as { requests?: unknown }

    if (!bodyRaw || typeof bodyRaw !== 'object' || !('requests' in bodyRaw)) {
      throw new RvfsError('EINVAL', 'Missing requests field', { status: 400 })
    }

    if (!Array.isArray(bodyRaw.requests)) {
      throw new RvfsError('EINVAL', 'requests must be an array', { status: 400 })
    }

    const requests = bodyRaw.requests as BatchRequest[]

    if (requests.length > 100) {
      throw new RvfsError('EINVAL', 'Batch limit is 100 operations', { status: 400 })
    }

    const authHeader = request.headers.authorization

    const responses: BatchResponse[] = []
    for (const req of requests) {
      try {
        const result = await app.inject({
          method: req.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
          url: req.path,
          headers: authHeader ? { authorization: authHeader } : {},
          payload: req.body !== undefined ? req.body : undefined,
        })
        let parsed: unknown
        try {
          parsed = result.json()
        } catch {
          parsed = result.payload || null
        }
        responses.push({ id: req.id, status: result.statusCode, body: parsed })
      } catch (err) {
        responses.push({ id: req.id, status: 500, body: { error: 'INTERNAL_ERROR' } })
      }
    }

    return reply.status(200).send({ responses })
  })
}
