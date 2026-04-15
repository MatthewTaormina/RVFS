import type { FastifyInstance } from 'fastify'
import type { EventEmitter } from 'node:events'
import type { StorageBackend, RvfsChangeEvent } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { validateSession, assertFsAccess } from '../auth.js'

/** Per-fsid ring buffer of recent events for replay to new SSE connections. */
const recentEvents = new Map<string, RvfsChangeEvent[]>()
const MAX_RECENT = 200

export function bufferEvent(fsid: string, event: RvfsChangeEvent): void {
  let buf = recentEvents.get(fsid)
  if (!buf) {
    buf = []
    recentEvents.set(fsid, buf)
  }
  buf.push(event)
  if (buf.length > MAX_RECENT) buf.shift()
}

export function registerWatchRoutes(
  app: FastifyInstance,
  storage: StorageBackend,
  emitter: EventEmitter,
): void {
  app.get('/fs/:fsid/watch', async (request, reply) => {
    const session = await validateSession(request, storage)
    const { fsid } = request.params as { fsid: string }

    const root = await storage.getFS(fsid)
    if (!root) {
      throw new RvfsError('ENOENT', 'Filesystem not found', { status: 404 })
    }
    assertFsAccess(session, fsid, 'read')

    // B8: parse SSE filter params
    const query = request.query as { since?: string; types?: string; paths?: string }
    const sinceDate = query.since ? new Date(query.since) : null
    const typeFilter = query.types ? query.types.split(',').map((t) => t.trim()) : null
    // paths: simple string-prefix match for V1 (full glob deferred to V2)
    const pathFilter = query.paths ? query.paths.split(',').map((p) => p.trim()) : null

    reply.hijack()

    // Register event listener BEFORE writing headers to minimize race window
    const pendingEvents: RvfsChangeEvent[] = []
    let streaming = false

    const listener = (event: RvfsChangeEvent) => {
      // B8: filter live events by types and paths
      if (typeFilter && !typeFilter.includes(event.event)) return
      if (pathFilter && event.path && !pathFilter.some((p) => event.path!.startsWith(p))) return
      if (streaming) {
        try {
          // B8: write id: field before event:
          reply.raw.write(`id: ${event.event_id}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch {
          // connection closed
        }
      } else {
        pendingEvents.push(event)
      }
    }

    emitter.on(`${fsid}:change`, listener)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    reply.raw.write(': type: text/event-stream\n')
    reply.raw.write(': keep-alive\n\n')

    // Replay any buffered events and flush pending ones
    streaming = true
    const buffered = recentEvents.get(fsid) ?? []
    const pendingIds = new Set(pendingEvents.map((e) => e.event_id))
    for (const event of buffered) {
      // B8: filter replayed events by since and types
      if (sinceDate && new Date(event.at) <= sinceDate) continue
      if (typeFilter && !typeFilter.includes(event.event)) continue
      if (!pendingIds.has(event.event_id)) {
        try {
          reply.raw.write(`id: ${event.event_id}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch {
          break
        }
      }
    }
    for (const event of pendingEvents) {
      try {
        reply.raw.write(`id: ${event.event_id}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        break
      }
    }

    const keepAliveInterval = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n')
      } catch {
        clearInterval(keepAliveInterval)
      }
    }, 25000)

    request.raw.on('close', () => {
      emitter.off(`${fsid}:change`, listener)
      clearInterval(keepAliveInterval)
    })

    request.raw.on('error', () => {
      emitter.off(`${fsid}:change`, listener)
      clearInterval(keepAliveInterval)
    })
  })
}
