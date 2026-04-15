import type { Session, MetaNode, FileMetaNode, DirMetaNode } from 'rvfs-types'
import { RvfsError } from './errors.js'

export function checkPermission(
  mode: number,
  fileUid: number,
  fileGid: number,
  callerUid: number,
  callerGid: number,
  operation: 'read' | 'write' | 'execute',
): boolean {
  if (callerUid === 0) return true

  const opBit = operation === 'read' ? 4 : operation === 'write' ? 2 : 1

  let relevant: number
  if (callerUid === fileUid) {
    relevant = (mode >> 6) & 7
  } else if (callerGid === fileGid) {
    relevant = (mode >> 3) & 7
  } else {
    relevant = mode & 7
  }

  return (relevant & opBit) !== 0
}

/**
 * Extract numeric uid/gid from session.metadata.
 * Defaults to uid=0 (root) when not set — ensures existing sessions have unrestricted access.
 */
export function getCallerUidGid(session: Session): { uid: number; gid: number } {
  const uid = typeof session.metadata?.uid === 'number' ? session.metadata.uid : 0
  const gid = typeof session.metadata?.gid === 'number' ? session.metadata.gid : 0
  return { uid, gid }
}

/**
 * Assert that the caller session has the given POSIX permission on `node`.
 * Root meta nodes (no mode) are always accessible.
 * Throws RvfsError('EACCES') on denial.
 */
export function assertNodePermission(
  session: Session,
  node: MetaNode,
  operation: 'read' | 'write' | 'execute',
): void {
  if (node.type === 'root') return // root nodes carry no mode; skip
  const typed = node as FileMetaNode | DirMetaNode
  const { uid, gid } = getCallerUidGid(session)
  if (!checkPermission(typed.meta.mode, typed.meta.uid, typed.meta.gid, uid, gid, operation)) {
    throw new RvfsError('EACCES', 'Permission denied', { nid: node.nid, status: 403 })
  }
}
