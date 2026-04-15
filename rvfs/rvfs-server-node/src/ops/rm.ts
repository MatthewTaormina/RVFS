import type { StorageBackend, MetaNode, RootMetaNode, DirMetaNode, FileMetaNode, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { canonicalizePath, resolvePath } from './create.js'
import { assertNodePermission } from '../permissions.js'

export interface RmPayload {
  path: string
  recursive?: boolean
}

async function removeNodeRecursive(storage: StorageBackend, node: MetaNode): Promise<void> {
  if (node.type === 'dir') {
    const dirNode = node as DirMetaNode
    for (const childNid of dirNode.children) {
      const child = await storage.getMeta(childNid)
      if (child) await removeNodeRecursive(storage, child)
    }
  } else if (node.type === 'file') {
    const fileNode = node as FileMetaNode
    if (fileNode.blob_nid) {
      const blobHeader = await storage.getBlobHeader(fileNode.blob_nid)
      if (blobHeader) {
        const newRefCount = blobHeader.ref_count - 1
        if (newRefCount <= 0) {
          await storage.deleteBlob(fileNode.blob_nid)
        } else {
          const blob = await storage.getBlob(fileNode.blob_nid)
          await storage.putBlob({ ...blobHeader, ref_count: newRefCount }, blob ?? new ArrayBuffer(0))
        }
      }
    }
  }
  await storage.deleteMeta(node.nid)
}

export async function rmNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: RmPayload,
): Promise<void> {
  const path = canonicalizePath(payload.path)

  const node = await resolvePath(storage, fsid, path)
  if (!node) {
    throw new RvfsError('ENOENT', 'Path not found', { path, status: 404 })
  }

  if (node.type === 'dir') {
    const dirNode = node as DirMetaNode
    if (dirNode.children.length > 0 && !payload.recursive) {
      throw new RvfsError('ENOTEMPTY', 'Directory is not empty', { path, status: 400 })
    }
  }

  if (node.type === 'root') {
    throw new RvfsError('EPERM', 'Cannot remove root node', { path, status: 400 })
  }

  const segments = path.split('/').filter(Boolean)
  const name = segments[segments.length - 1]
  const parentPath = '/' + segments.slice(0, -1).join('/')

  const parentNode = await resolvePath(storage, fsid, parentPath)
  if (parentNode && (parentNode.type === 'root' || parentNode.type === 'dir')) {
    // Q3: check write permission on parent directory
    assertNodePermission(session, parentNode, 'write')
    const parent = parentNode as RootMetaNode | DirMetaNode
    const newNameIndex = { ...parent.name_index }
    delete newNameIndex[name]
    const newChildren = parent.children.filter((c) => c !== node.nid)

    if (parentNode.type === 'root') {
      await storage.putFS({
        ...(parentNode as RootMetaNode),
        children: newChildren,
        name_index: newNameIndex,
        updated_at: new Date().toISOString(),
      })
    } else {
      await storage.putMeta({
        ...(parentNode as DirMetaNode),
        children: newChildren,
        name_index: newNameIndex,
        updated_at: new Date().toISOString(),
      })
    }
  }

  await removeNodeRecursive(storage, node)
}
