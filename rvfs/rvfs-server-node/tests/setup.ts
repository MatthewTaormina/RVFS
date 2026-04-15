/**
 * Shared test helpers for rvfs-server-node tests.
 *
 * NOTE: createServer and MemoryStorageBackend are stubs right now — calling
 * makeServer() will throw "createServer is not a function". That is CORRECT;
 * these helpers exist so that the test files can import them and the failures
 * are uniform and informative.
 */

// @ts-ignore — stubs export {} until Alex implements them
import { createServer } from '../src/server.js'
// @ts-ignore
import { MemoryStorageBackend } from '../src/storage/memory.js'
import type { FastifyInstance } from 'fastify'
import type { Session } from 'rvfs-types'

/** Spin up a fresh in-memory server. Called in beforeEach. */
export function makeServer(): FastifyInstance {
  const storage = new MemoryStorageBackend()
  return createServer({ storage }) as FastifyInstance
}

/** POST /session and return the session_id bearer token. */
export async function createSession(
  app: FastifyInstance,
  identity = 'test-user',
  ttl_seconds = 3600,
  filesystems: Array<{ fsid: string; access: string }> = [],
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/session',
    payload: { identity, ttl_seconds, filesystems },
  })
  if (res.statusCode !== 201) {
    throw new Error(`createSession failed: ${res.statusCode} — ${res.body}`)
  }
  return (res.json() as Session).session_id
}

/**
 * POST /fs and return the fsid + root_nid.
 * sessionId is added to the session's filesystems as 'admin' automatically by
 * the server (the creating session always gets admin access).
 */
export async function createFs(
  app: FastifyInstance,
  sessionId: string,
  label = 'test-fs',
  ttl: number | null = null,
): Promise<{ fsid: string; root_nid: string; label: string; created_at: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/fs',
    headers: { authorization: `Bearer ${sessionId}` },
    payload: { label, ttl },
  })
  if (res.statusCode !== 201) {
    throw new Error(`createFs failed: ${res.statusCode} — ${res.body}`)
  }
  return res.json()
}

/** POST /fs/:fsid/op/create and return the response body. */
export async function opCreate(
  app: FastifyInstance,
  sessionId: string,
  fsid: string,
  payload: Record<string, unknown>,
): Promise<{ nid: string; path: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/fs/${fsid}/op/create`,
    headers: { authorization: `Bearer ${sessionId}` },
    payload,
  })
  if (res.statusCode !== 201) {
    throw new Error(`opCreate failed: ${res.statusCode} — ${res.body}`)
  }
  return res.json()
}

/** POST /fs/:fsid/op/write and return the raw response. */
export async function opWrite(
  app: FastifyInstance,
  sessionId: string,
  fsid: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/fs/${fsid}/op/write`,
    headers: { authorization: `Bearer ${sessionId}` },
    payload,
  })
}

/** POST /fs/:fsid/op/read and return the raw response. */
export async function opRead(
  app: FastifyInstance,
  sessionId: string,
  fsid: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/fs/${fsid}/op/read`,
    headers: { authorization: `Bearer ${sessionId}` },
    payload,
  })
}
