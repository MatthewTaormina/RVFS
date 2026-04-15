import { createHash } from 'node:crypto'
import type { FastifyReply } from 'fastify'
import type { MetaNode, RootMetaNode } from 'rvfs-types'

/**
 * Set RVFS response headers per §9.8:
 * - X-Node-TTL: remaining seconds on this node's TTL (omitted if ttl is null)
 * - X-FS-TTL: remaining seconds on the filesystem's TTL (omitted if fs.ttl is null)
 * - ETag: SHA-256 of blob for file nodes; SHA-256 of nid for dir/root nodes
 * Note: X-Expired header (soft-expiry window) is omitted — MetaNode has no soft_expires_at field (V2).
 */
export function setNodeHeaders(
  reply: FastifyReply,
  node: MetaNode,
  fs: RootMetaNode,
  blobSha256?: string | null,
): void {
  const now = Date.now()

  // X-Node-TTL: remaining TTL of this node in seconds
  if (node.ttl !== null) {
    const created = new Date(node.created_at).getTime()
    const remaining = Math.max(0, Math.round((created + node.ttl * 1000 - now) / 1000))
    reply.header('x-node-ttl', String(remaining))
  }

  // X-FS-TTL: remaining TTL of the filesystem in seconds
  if (fs.ttl !== null) {
    const created = new Date(fs.created_at).getTime()
    const remaining = Math.max(0, Math.round((created + fs.ttl * 1000 - now) / 1000))
    reply.header('x-fs-ttl', String(remaining))
  }

  // ETag: blob sha256 for file nodes; sha256 of nid for dir/root nodes
  if (node.type === 'file') {
    if (blobSha256) {
      reply.header('etag', `"${blobSha256}"`)
    }
  } else {
    const nidHash = createHash('sha256').update(node.nid).digest('hex')
    reply.header('etag', `"${nidHash}"`)
  }
}
