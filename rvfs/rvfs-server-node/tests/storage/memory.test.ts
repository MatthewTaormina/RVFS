/**
 * Storage backend unit tests — MemoryStorageBackend
 * §9.9 StorageBackend interface compliance.
 *
 * Imports directly from the implementation (not via HTTP) to validate that
 * each StorageBackend method meets its contract in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore — stub until Alex implements
import { MemoryStorageBackend } from '../../src/storage/memory.js'
import type { StorageBackend, MetaNode, BlobHeader, RootMetaNode, Session } from 'rvfs-types'

const NOW = new Date().toISOString()

function makeRoot(fsid: string): RootMetaNode {
  return {
    nid: crypto.randomUUID(),
    type: 'root',
    fsid,
    label: 'test',
    created_at: NOW,
    updated_at: NOW,
    ttl: null,
    owner: 'test-user',
    fork_of: null,
    fork_depth: 0,
    children: [],
    name_index: {},
  }
}

function makeFileNode(fsid: string): MetaNode {
  return {
    nid: crypto.randomUUID(),
    type: 'file',
    name: 'test.txt',
    parent_nid: null,
    fsid,
    created_at: NOW,
    updated_at: NOW,
    ttl: null,
    meta: {
      mode: 0o644,
      uid: 1000,
      gid: 1000,
      atime: NOW,
      mtime: NOW,
      ctime: NOW,
      nlink: 1,
      inode: 1,
    },
    blob_nid: null,
    size: 0,
    symlink_target: null,
  }
}

function makeBlobHeader(fsid: string): BlobHeader {
  return {
    nid: crypto.randomUUID(),
    type: 'blob',
    fsid,
    size: 4,
    mime_type: 'text/plain',
    sha256: 'aabbcc',
    created_at: NOW,
    ttl: null,
    ref_count: 0,
  }
}

function makeSession(): Session {
  return {
    session_id: crypto.randomUUID(),
    identity: 'user-store',
    created_at: NOW,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ttl_seconds: 3600,
    filesystems: [],
    metadata: {},
  }
}

describe('MemoryStorageBackend — meta nodes', () => {
  let storage: StorageBackend

  beforeEach(() => {
    storage = new MemoryStorageBackend()
  })

  it('putMeta then getMeta returns the same node', async () => {
    const node = makeFileNode('fs-meta-1')
    await storage.putMeta(node)
    const result = await storage.getMeta(node.nid)
    expect(result).toEqual(node)
  })

  it('getMeta returns null for an unknown nid', async () => {
    const result = await storage.getMeta(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('patchMeta applies a partial update and returns the merged node', async () => {
    const node = makeFileNode('fs-patch-1')
    await storage.putMeta(node)

    const updated = await storage.patchMeta(node.nid, { name: 'renamed.txt' } as Partial<MetaNode>)
    expect(updated.nid).toBe(node.nid)
    expect((updated as { name: string }).name).toBe('renamed.txt')
  })

  it('deleteMeta then getMeta returns null', async () => {
    const node = makeFileNode('fs-del-1')
    await storage.putMeta(node)
    await storage.deleteMeta(node.nid)
    const result = await storage.getMeta(node.nid)
    expect(result).toBeNull()
  })

  it('putMeta replaces an existing node (upsert semantics)', async () => {
    const node = makeFileNode('fs-upsert')
    await storage.putMeta(node)

    const updated = { ...node, name: 'replaced.txt' }
    await storage.putMeta(updated as MetaNode)

    const result = await storage.getMeta(node.nid) as { name: string }
    expect(result.name).toBe('replaced.txt')
  })
})

describe('MemoryStorageBackend — blob nodes', () => {
  let storage: StorageBackend

  beforeEach(() => {
    storage = new MemoryStorageBackend()
  })

  it('putBlob then getBlob returns the same content', async () => {
    const content = new TextEncoder().encode('hello blob').buffer as ArrayBuffer
    const header = makeBlobHeader('fs-blob-1')
    const nid = await storage.putBlob(header, content)

    const result = await storage.getBlob(nid)
    expect(result).not.toBeNull()
    expect(new Uint8Array(result!)).toEqual(new Uint8Array(content))
  })

  it('getBlobHeader returns the correct header', async () => {
    const content = new TextEncoder().encode('header check').buffer as ArrayBuffer
    const header = makeBlobHeader('fs-blob-2')
    const nid = await storage.putBlob(header, content)

    const result = await storage.getBlobHeader(nid)
    expect(result).not.toBeNull()
    expect(result!.size).toBe(header.size)
    expect(result!.mime_type).toBe(header.mime_type)
    expect(result!.sha256).toBe(header.sha256)
  })

  it('getBlob returns null for unknown nid', async () => {
    const result = await storage.getBlob(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('getBlobHeader returns null for unknown nid', async () => {
    const result = await storage.getBlobHeader(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('deleteBlob then getBlob returns null', async () => {
    const content = new TextEncoder().encode('delete me').buffer as ArrayBuffer
    const header = makeBlobHeader('fs-blob-3')
    const nid = await storage.putBlob(header, content)

    await storage.deleteBlob(nid)
    const result = await storage.getBlob(nid)
    expect(result).toBeNull()
  })

  it('putBlob returns the nid string', async () => {
    const content = new TextEncoder().encode('nid check').buffer as ArrayBuffer
    const header = makeBlobHeader('fs-blob-4')
    const nid = await storage.putBlob(header, content)
    expect(typeof nid).toBe('string')
    expect(nid.length).toBeGreaterThan(0)
  })
})

describe('MemoryStorageBackend — filesystem roots', () => {
  let storage: StorageBackend

  beforeEach(() => {
    storage = new MemoryStorageBackend()
  })

  it('putFS then getFS returns the root node', async () => {
    const fsid = crypto.randomUUID()
    const root = makeRoot(fsid)
    await storage.putFS(root)

    const result = await storage.getFS(fsid)
    expect(result).toEqual(root)
  })

  it('getFS returns null for unknown fsid', async () => {
    const result = await storage.getFS(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('deleteFS then getFS returns null', async () => {
    const fsid = crypto.randomUUID()
    await storage.putFS(makeRoot(fsid))
    await storage.deleteFS(fsid)
    const result = await storage.getFS(fsid)
    expect(result).toBeNull()
  })

  it('deleteFS cascades to owned meta nodes', async () => {
    const fsid = crypto.randomUUID()
    await storage.putFS(makeRoot(fsid))

    const node = makeFileNode(fsid)
    await storage.putMeta(node)

    await storage.deleteFS(fsid)

    // The meta node should also be gone
    const result = await storage.getMeta(node.nid)
    expect(result).toBeNull()
  })
})

describe('MemoryStorageBackend — listFSNodes', () => {
  let storage: StorageBackend

  beforeEach(() => {
    storage = new MemoryStorageBackend()
  })

  it('returns nids for all nodes belonging to the given fsid', async () => {
    const fsid = crypto.randomUUID()
    await storage.putFS(makeRoot(fsid))

    const n1 = makeFileNode(fsid)
    const n2 = makeFileNode(fsid)
    await storage.putMeta(n1)
    await storage.putMeta(n2)

    const result = await storage.listFSNodes(fsid)
    expect(result.nids).toContain(n1.nid)
    expect(result.nids).toContain(n2.nid)
  })

  it('does not return nodes from other filesystems', async () => {
    const fsidA = crypto.randomUUID()
    const fsidB = crypto.randomUUID()
    await storage.putFS(makeRoot(fsidA))
    await storage.putFS(makeRoot(fsidB))

    const nodeA = makeFileNode(fsidA)
    const nodeB = makeFileNode(fsidB)
    await storage.putMeta(nodeA)
    await storage.putMeta(nodeB)

    const resultA = await storage.listFSNodes(fsidA)
    expect(resultA.nids).not.toContain(nodeB.nid)
  })

  it('returns { nids, cursor } shape', async () => {
    const fsid = crypto.randomUUID()
    await storage.putFS(makeRoot(fsid))

    const result = await storage.listFSNodes(fsid)
    expect(Array.isArray(result.nids)).toBe(true)
    expect('cursor' in result).toBe(true)
  })
})

describe('MemoryStorageBackend — sessions', () => {
  let storage: StorageBackend

  beforeEach(() => {
    storage = new MemoryStorageBackend()
  })

  it('putSession then getSession returns the session', async () => {
    const session = makeSession()
    await storage.putSession(session)

    const result = await storage.getSession(session.session_id)
    expect(result).toEqual(session)
  })

  it('getSession returns null for unknown session_id', async () => {
    const result = await storage.getSession(crypto.randomUUID())
    expect(result).toBeNull()
  })

  it('deleteSession then getSession returns null', async () => {
    const session = makeSession()
    await storage.putSession(session)
    await storage.deleteSession(session.session_id)

    const result = await storage.getSession(session.session_id)
    expect(result).toBeNull()
  })

  it('putSession replaces an existing session (upsert)', async () => {
    const session = makeSession()
    await storage.putSession(session)

    const updated: Session = { ...session, ttl_seconds: 9999 }
    await storage.putSession(updated)

    const result = await storage.getSession(session.session_id)
    expect(result?.ttl_seconds).toBe(9999)
  })
})
