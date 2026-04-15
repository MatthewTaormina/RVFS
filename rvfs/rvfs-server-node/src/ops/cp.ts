import type { StorageBackend, MetaNode, RootMetaNode, DirMetaNode, FileMetaNode, BlobHeader, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { canonicalizePath, resolvePath } from './create.js'

export interface CpPayload {
  src: string
  dst: string
  recursive?: boolean
}

async function copyNode(
  storage: StorageBackend,
  srcNode: MetaNode,
  dstPath: string,
  dstName: string,
  dstParentNid: string,
  fsid: string,
): Promise<MetaNode> {
  const now = new Date().toISOString()
  const newNid = 'n-' + crypto.randomUUID()

  if (srcNode.type === 'file') {
    const srcFile = srcNode as FileMetaNode
    let newBlobNid: string | null = null

    if (srcFile.blob_nid) {
      const oldHeader = await storage.getBlobHeader(srcFile.blob_nid)
      const oldContent = await storage.getBlob(srcFile.blob_nid)
      if (oldHeader && oldContent) {
        const newBlobHeader: BlobHeader = {
          ...oldHeader,
          nid: 'n-' + crypto.randomUUID(),
          ref_count: 1,
          created_at: now,
        }
        await storage.putBlob(newBlobHeader, oldContent)
        newBlobNid = newBlobHeader.nid
      }
    }

    const newFile: FileMetaNode = {
      ...srcFile,
      nid: newNid,
      name: dstName,
      parent_nid: dstParentNid,
      blob_nid: newBlobNid,
      created_at: now,
      updated_at: now,
    }
    await storage.putMeta(newFile)
    return newFile
  } else if (srcNode.type === 'dir') {
    const srcDir = srcNode as DirMetaNode
    const newDir: DirMetaNode = {
      ...srcDir,
      nid: newNid,
      name: dstName,
      parent_nid: dstParentNid,
      children: [],
      name_index: {},
      created_at: now,
      updated_at: now,
    }
    await storage.putMeta(newDir)

    const childNameIndex: Record<string, string> = {}
    const childNids: string[] = []

    for (const childNid of srcDir.children) {
      const child = await storage.getMeta(childNid)
      if (!child) continue
      const childName = child.type === 'file'
        ? (child as FileMetaNode).name
        : child.type === 'dir'
          ? (child as DirMetaNode).name
          : ''
      const copiedChild = await copyNode(
        storage,
        child,
        dstPath + '/' + childName,
        childName,
        newNid,
        fsid,
      )
      childNameIndex[childName] = copiedChild.nid
      childNids.push(copiedChild.nid)
    }

    const finalDir: DirMetaNode = { ...newDir, children: childNids, name_index: childNameIndex }
    await storage.putMeta(finalDir)
    return finalDir
  }

  throw new RvfsError('EINVAL', 'Cannot copy root node', { status: 400 })
}

export async function cpNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: CpPayload,
): Promise<void> {
  const srcPath = canonicalizePath(payload.src)
  const dstPath = canonicalizePath(payload.dst)

  const srcNode = await resolvePath(storage, fsid, srcPath)
  if (!srcNode) {
    throw new RvfsError('ENOENT', 'Source not found', { path: srcPath, status: 404 })
  }

  if (srcNode.type === 'dir' && !payload.recursive) {
    throw new RvfsError('EISDIR', 'Use recursive: true to copy directories', { path: srcPath, status: 400 })
  }

  const dstSegments = dstPath.split('/').filter(Boolean)
  const dstName = dstSegments[dstSegments.length - 1] ?? ''
  const dstParentPath = '/' + dstSegments.slice(0, -1).join('/')

  const dstParent = await resolvePath(storage, fsid, dstParentPath)
  if (!dstParent || (dstParent.type !== 'root' && dstParent.type !== 'dir')) {
    throw new RvfsError('ENOENT', 'Destination parent not found', { path: dstParentPath, status: 404 })
  }

  const dstParentTyped = dstParent as RootMetaNode | DirMetaNode
  const copiedNode = await copyNode(storage, srcNode, dstPath, dstName, dstParent.nid, fsid)

  const newNameIndex = { ...dstParentTyped.name_index, [dstName]: copiedNode.nid }
  const newChildren = [...dstParentTyped.children, copiedNode.nid]

  if (dstParent.type === 'root') {
    await storage.putFS({
      ...(dstParent as RootMetaNode),
      children: newChildren,
      name_index: newNameIndex,
      updated_at: new Date().toISOString(),
    })
  } else {
    await storage.putMeta({
      ...(dstParent as DirMetaNode),
      children: newChildren,
      name_index: newNameIndex,
      updated_at: new Date().toISOString(),
    })
  }
}
