import type { FastifyInstance } from 'fastify'
import type { StorageBackend } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession } from '../auth.js'
import { validate, BatchSchema } from '../schemas.js'

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

    const validated = validate(BatchSchema, request.body)
    const requests = validated.requests as BatchRequest[]

    // W4: allowlist HTTP methods to prevent unexpected internal routing
    const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    for (const req of requests) {
      if (!ALLOWED_METHODS.includes(req.method.toUpperCase())) {
        throw new RvfsError('EINVAL', `Method not allowed in batch: ${req.method}`, { status: 400 })
      }
    }

    const authHeader = request.headers.authorization

    const responses: BatchResponse[] = []
    for (const req of requests) {
      try {
        const result = await app.inject({
          method: req.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
          url: req.path,
          headers: authHeader ? { authorization: authHeader, 'x-rvfs-internal': 'batch' } : { 'x-rvfs-internal': 'batch' },
          payload: req.body != null ? (req.body as string | object) : undefined,
        })
        let parsed: unknown
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsed = (result as any).json()
        } catch {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsed = (result as any).payload || null
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responses.push({ id: req.id, status: (result as any).statusCode, body: parsed })
      } catch (err) {
        responses.push({ id: req.id, status: 500, body: { error: 'INTERNAL_ERROR' } })
      }
    }

    return reply.status(200).send({ responses })
  })
}
