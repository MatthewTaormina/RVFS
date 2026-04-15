import type { StorageBackend, MetaNode, RootMetaNode, DirMetaNode, FileMetaNode, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { canonicalizePath, resolvePath } from './create.js'

export interface MvPayload {
  src: string
  dst: string
}

export async function mvNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: MvPayload,
): Promise<void> {
  const srcPath = canonicalizePath(payload.src)
  const dstPath = canonicalizePath(payload.dst)

  const srcNode = await resolvePath(storage, fsid, srcPath)
  if (!srcNode) {
    throw new RvfsError('ENOENT', 'Source not found', { path: srcPath, status: 404 })
  }

  const dstSegments = dstPath.split('/').filter(Boolean)
  const dstName = dstSegments[dstSegments.length - 1] ?? ''
  const dstParentPath = '/' + dstSegments.slice(0, -1).join('/')

  const dstParent = await resolvePath(storage, fsid, dstParentPath)
  if (!dstParent || (dstParent.type !== 'root' && dstParent.type !== 'dir')) {
    throw new RvfsError('ENOENT', 'Destination parent not found', { path: dstParentPath, status: 404 })
  }

  const dstParentTyped = dstParent as RootMetaNode | DirMetaNode

  const existingDst = dstParentTyped.name_index[dstName]
  if (existingDst) {
    const existing = await storage.getMeta(existingDst)
    if (existing) await storage.deleteMeta(existing.nid)
    const newDstNameIndex = { ...dstParentTyped.name_index }
    delete newDstNameIndex[dstName]
    const newDstChildren = dstParentTyped.children.filter((c) => c !== existingDst)
    if (dstParent.type === 'root') {
      await storage.putFS({ ...(dstParent as RootMetaNode), children: newDstChildren, name_index: newDstNameIndex })
    } else {
      await storage.putMeta({ ...(dstParent as DirMetaNode), children: newDstChildren, name_index: newDstNameIndex })
    }
  }

  const srcSegments = srcPath.split('/').filter(Boolean)
  const srcName = srcSegments[srcSegments.length - 1] ?? ''
  const srcParentPath = '/' + srcSegments.slice(0, -1).join('/')
  const srcParent = await resolvePath(storage, fsid, srcParentPath)

  if (srcParent && (srcParent.type === 'root' || srcParent.type === 'dir')) {
    const sp = srcParent as RootMetaNode | DirMetaNode
    const newSrcNameIndex = { ...sp.name_index }
    delete newSrcNameIndex[srcName]
    const newSrcChildren = sp.children.filter((c) => c !== srcNode.nid)
    if (srcParent.type === 'root') {
      await storage.putFS({ ...(srcParent as RootMetaNode), children: newSrcChildren, name_index: newSrcNameIndex })
    } else {
      await storage.putMeta({ ...(srcParent as DirMetaNode), children: newSrcChildren, name_index: newSrcNameIndex })
    }
  }

  const now = new Date().toISOString()
  let updatedNode: MetaNode
  if (srcNode.type === 'file') {
    updatedNode = { ...(srcNode as FileMetaNode), name: dstName, parent_nid: dstParent.nid, updated_at: now }
  } else if (srcNode.type === 'dir') {
    updatedNode = { ...(srcNode as DirMetaNode), name: dstName, parent_nid: dstParent.nid, updated_at: now }
  } else {
    updatedNode = { ...(srcNode as RootMetaNode), updated_at: now }
  }
  await storage.putMeta(updatedNode)

  const refreshedDstParent = await resolvePath(storage, fsid, dstParentPath)
  if (refreshedDstParent && (refreshedDstParent.type === 'root' || refreshedDstParent.type === 'dir')) {
    const dp = refreshedDstParent as RootMetaNode | DirMetaNode
    const newDstNameIndex = { ...dp.name_index, [dstName]: srcNode.nid }
    const newDstChildren = [...dp.children, srcNode.nid]
    if (refreshedDstParent.type === 'root') {
      await storage.putFS({ ...(refreshedDstParent as RootMetaNode), children: newDstChildren, name_index: newDstNameIndex })
    } else {
      await storage.putMeta({ ...(refreshedDstParent as DirMetaNode), children: newDstChildren, name_index: newDstNameIndex })
    }
  }
}
