import type { FastifyRequest } from 'fastify'
import type { Session, SessionAccess, StorageBackend } from 'rvfs-types'
import { RvfsError } from './errors.js'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function validateSession(
  request: FastifyRequest,
  storage: StorageBackend,
): Promise<Session> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new RvfsError('FORBIDDEN', 'Missing or invalid Authorization header', { status: 401 })
  }
  const token = authHeader.slice(7)
  if (!UUID_V4_RE.test(token)) {
    throw new RvfsError('FORBIDDEN', 'Invalid token format', { status: 401 })
  }
  const session = await storage.getSession(token)
  if (!session) {
    throw new RvfsError('FORBIDDEN', 'Session not found or revoked', { status: 401 })
  }
  if (new Date(session.expires_at) < new Date()) {
    throw new RvfsError('FORBIDDEN', 'Session expired', { status: 401 })
  }
  return session
}

const ACCESS_LEVELS: Record<SessionAccess, number> = { read: 0, write: 1, admin: 2 }

export function assertFsAccess(
  session: Session,
  fsid: string,
  required: SessionAccess,
): void {
  const entry = session.filesystems.find((f) => f.fsid === fsid)
  if (!entry) {
    throw new RvfsError('FORBIDDEN', 'Access denied to filesystem', { status: 403 })
  }
  if (ACCESS_LEVELS[entry.access] < ACCESS_LEVELS[required]) {
    throw new RvfsError('FORBIDDEN', 'Insufficient access level', { status: 403 })
  }
}
