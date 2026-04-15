import { createHash } from 'node:crypto'
import type { StorageBackend, MetaNode, RootMetaNode, DirMetaNode, FileMetaNode, BlobHeader, Session } from 'rvfs-types'
import { RvfsError } from '../errors.js'

export function canonicalizePath(inputPath: string): string {
  const segments = inputPath.split('/')
  for (const seg of segments) {
    if (seg === '..') {
      throw new RvfsError('EACCES', 'Path traversal not allowed', { path: inputPath, status: 400 })
    }
  }
  const cleaned = segments.filter((s) => s !== '' && s !== '.')
  return '/' + cleaned.join('/')
}

export async function resolvePath(
  storage: StorageBackend,
  fsid: string,
  path: string,
): Promise<MetaNode | null> {
  const root = await storage.getFS(fsid)
  if (!root) return null
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return root
  let current: MetaNode = root
  for (const seg of segments) {
    if (current.type !== 'root' && current.type !== 'dir') return null
    const nid = (current as RootMetaNode | DirMetaNode).name_index[seg]
    if (!nid) return null
    const child = await storage.getMeta(nid)
    if (!child) return null
    current = child
  }
  return current
}

export interface CreateNodePayload {
  path: string
  type: 'file' | 'dir' | 'symlink'
  content?: string
  meta?: { mode?: number; uid?: number; gid?: number }
  symlink_target?: string
}

function makeLinuxMeta(overrides?: { mode?: number; uid?: number; gid?: number }) {
  const now = new Date().toISOString()
  return {
    mode: overrides?.mode ?? 0o644,
    uid: overrides?.uid ?? 1000,
    gid: overrides?.gid ?? 1000,
    atime: now,
    mtime: now,
    ctime: now,
    nlink: 1,
    inode: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  }
}

export async function createNodeOp(
  storage: StorageBackend,
  session: Session,
  fsid: string,
  payload: CreateNodePayload,
): Promise<{ nid: string; path: string }> {
  const path = canonicalizePath(payload.path)

  const segments = path.split('/').filter(Boolean)
  const name = segments[segments.length - 1] ?? ''
  const parentPath = '/' + segments.slice(0, -1).join('/')

  const parentNode = await resolvePath(storage, fsid, parentPath)
  if (!parentNode) {
    throw new RvfsError('ENOENT', 'Parent directory not found', { path: parentPath, status: 404 })
  }
  if (parentNode.type !== 'root' && parentNode.type !== 'dir') {
    throw new RvfsError('ENOTDIR', 'Parent is not a directory', { path: parentPath, status: 400 })
  }

  const parentTyped = parentNode as RootMetaNode | DirMetaNode
  if (name && parentTyped.name_index[name]) {
    throw new RvfsError('EEXIST', 'Path already exists', { path, status: 409 })
  }

  const now = new Date().toISOString()
  const nid = 'n-' + crypto.randomUUID()

  let blobNid: string | null = null

  if (payload.type === 'file' && payload.content !== undefined && payload.content !== '') {
    const contentBuf = Buffer.from(payload.content, 'utf-8')
    const sha256 = createHash('sha256').update(contentBuf).digest('hex')
    const blobHeader: BlobHeader = {
      nid: 'n-' + crypto.randomUUID(),
      type: 'blob',
      fsid,
      size: contentBuf.byteLength,
      mime_type: 'text/plain; charset=utf-8',
      sha256,
      created_at: now,
      ttl: null,
      ref_count: 1,
    }
    const ab = contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.byteLength)
    await storage.putBlob(blobHeader, ab)
    blobNid = blobHeader.nid
  }

  let newNode: MetaNode
  if (payload.type === 'file') {
    const fileNode: FileMetaNode = {
      nid,
      type: 'file',
      name: name || '/',
      parent_nid: parentNode.nid,
      fsid,
      created_at: now,
      updated_at: now,
      ttl: null,
      meta: makeLinuxMeta(payload.meta),
      blob_nid: blobNid,
      size: blobNid ? Buffer.from(payload.content ?? '', 'utf-8').byteLength : 0,
      symlink_target: null,
    }
    newNode = fileNode
  } else if (payload.type === 'dir') {
    const dirNode: DirMetaNode = {
      nid,
      type: 'dir',
      name: name || '/',
      parent_nid: parentNode.nid,
      fsid,
      created_at: now,
      updated_at: now,
      ttl: null,
      meta: { ...makeLinuxMeta(payload.meta), mode: payload.meta?.mode ?? 0o755 },
      children: [],
      name_index: {},
    }
    newNode = dirNode
  } else {
    const fileNode: FileMetaNode = {
      nid,
      type: 'file',
      name: name || '/',
      parent_nid: parentNode.nid,
      fsid,
      created_at: now,
      updated_at: now,
      ttl: null,
      meta: { ...makeLinuxMeta(payload.meta), mode: 0o777 },
      blob_nid: null,
      size: 0,
      symlink_target: payload.symlink_target ?? null,
    }
    newNode = fileNode
  }

  await storage.putMeta(newNode)

  const updatedNameIndex = { ...parentTyped.name_index, [name]: nid }
  const updatedChildren = [...parentTyped.children, nid]

  if (parentNode.type === 'root') {
    const updatedRoot: RootMetaNode = {
      ...(parentNode as RootMetaNode),
      children: updatedChildren,
      name_index: updatedNameIndex,
      updated_at: now,
    }
    await storage.putFS(updatedRoot)
  } else {
    const updatedDir: DirMetaNode = {
      ...(parentNode as DirMetaNode),
      children: updatedChildren,
      name_index: updatedNameIndex,
      updated_at: now,
    }
    await storage.putMeta(updatedDir)
  }

  return { nid, path }
}
