import { createHash } from 'node:crypto'
import type { StorageBackend, MetaNode, FileMetaNode, BlobHeader, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'
import { canonicalizePath, resolvePath, createNodeOp } from './create.js'

export interface WritePayload {
  path: string
  content: string
  create_if_missing?: boolean
  append?: boolean
}

export interface ReadPayload {
  path: string
}

export async function writeNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: WritePayload,
): Promise<void> {
  const path = canonicalizePath(payload.path)

  let node = await resolvePath(storage, fsid, path)

  if (!node) {
    if (payload.create_if_missing) {
      await createNodeOp(storage, session, fsid, { path, type: 'file' })
      node = await resolvePath(storage, fsid, path)
    } else {
      throw new RvfsError('ENOENT', 'File not found', { path, status: 404 })
    }
  }

  if (!node || node.type !== 'file') {
    throw new RvfsError('EISDIR', 'Path is not a file', { path, status: 400 })
  }

  const fileNode = node as FileMetaNode

  let newContent: Buffer
  if (payload.append && fileNode.blob_nid) {
    const existing = await storage.getBlob(fileNode.blob_nid)
    const existingBuf = existing ? Buffer.from(existing) : Buffer.alloc(0)
    newContent = Buffer.concat([existingBuf, Buffer.from(payload.content, 'utf-8')])
  } else {
    newContent = Buffer.from(payload.content, 'utf-8')
  }

  if (fileNode.blob_nid) {
    const oldHeader = await storage.getBlobHeader(fileNode.blob_nid)
    if (oldHeader) {
      const newRefCount = oldHeader.ref_count - 1
      if (newRefCount <= 0) {
        await storage.deleteBlob(fileNode.blob_nid)
      } else {
        await storage.putBlob({ ...oldHeader, ref_count: newRefCount }, await storage.getBlob(fileNode.blob_nid) ?? new ArrayBuffer(0))
      }
    }
  }

  const sha256 = createHash('sha256').update(newContent).digest('hex')
  const now = new Date().toISOString()
  const blobHeader: BlobHeader = {
    nid: 'n-' + crypto.randomUUID(),
    type: 'blob',
    fsid,
    size: newContent.byteLength,
    mime_type: 'text/plain; charset=utf-8',
    sha256,
    created_at: now,
    ttl: null,
    ref_count: 1,
  }
  const ab = newContent.buffer.slice(newContent.byteOffset, newContent.byteOffset + newContent.byteLength)
  await storage.putBlob(blobHeader, ab)

  const updatedFile: FileMetaNode = {
    ...fileNode,
    blob_nid: blobHeader.nid,
    size: newContent.byteLength,
    updated_at: now,
  }
  await storage.putMeta(updatedFile)
}

export async function readNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: ReadPayload,
): Promise<{ node: MetaNode }> {
  const path = canonicalizePath(payload.path)
  const node = await resolvePath(storage, fsid, path)
  if (!node) {
    throw new RvfsError('ENOENT', 'Path not found', { path, status: 404 })
  }
  return { node }
}
