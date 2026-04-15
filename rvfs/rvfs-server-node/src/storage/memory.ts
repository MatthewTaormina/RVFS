import type { StorageBackend, MetaNode, RootMetaNode, BlobHeader, Session } from 'rvfs-types'

export class MemoryStorageBackend implements StorageBackend {
  private meta = new Map<string, MetaNode>()
  private blobs = new Map<string, ArrayBuffer>()
  private blobHeaders = new Map<string, BlobHeader>()
  private filesystems = new Map<string, RootMetaNode>()
  private sessions = new Map<string, Session>()
  private _revokedSessions = new Set<string>()

  isRevoked(sessionId: string): boolean {
    return this._revokedSessions.has(sessionId)
  }

  async getMeta(nid: string): Promise<MetaNode | null> {
    return this.meta.get(nid) ?? null
  }

  async putMeta(node: MetaNode): Promise<void> {
    this.meta.set(node.nid, node)
    if (node.type === 'root') {
      this.filesystems.set(node.fsid, node as RootMetaNode)
    }
  }

  async patchMeta(nid: string, patch: Partial<MetaNode>): Promise<MetaNode> {
    const existing = this.meta.get(nid)
    if (!existing) throw new Error(`Node not found: ${nid}`)
    const updated = { ...existing, ...patch } as MetaNode
    await this.putMeta(updated)
    return updated
  }

  async deleteMeta(nid: string): Promise<void> {
    this.meta.delete(nid)
  }

  async getBlobHeader(nid: string): Promise<BlobHeader | null> {
    return this.blobHeaders.get(nid) ?? null
  }

  async getBlob(nid: string): Promise<ArrayBuffer | null> {
    return this.blobs.get(nid) ?? null
  }

  async putBlob(header: BlobHeader, content: ArrayBuffer): Promise<string> {
    this.blobHeaders.set(header.nid, header)
    this.blobs.set(header.nid, content)
    return header.nid
  }

  async deleteBlob(nid: string): Promise<void> {
    this.blobHeaders.delete(nid)
    this.blobs.delete(nid)
  }

  async getFS(fsid: string): Promise<RootMetaNode | null> {
    return this.filesystems.get(fsid) ?? null
  }

  async putFS(root: RootMetaNode): Promise<void> {
    this.filesystems.set(root.fsid, root)
    this.meta.set(root.nid, root)
  }

  async deleteFS(fsid: string): Promise<void> {
    const root = this.filesystems.get(fsid)
    if (root) this.meta.delete(root.nid)
    this.filesystems.delete(fsid)
    for (const [nid, node] of this.meta) {
      if (node.fsid === fsid) this.meta.delete(nid)
    }
    for (const [nid, header] of this.blobHeaders) {
      if (header.fsid === fsid) {
        this.blobHeaders.delete(nid)
        this.blobs.delete(nid)
      }
    }
  }

  async listFSNodes(
    fsid: string,
    cursor?: string,
    limit = 100,
  ): Promise<{ nids: string[]; cursor: string | null }> {
    const allNids: string[] = []
    const root = this.filesystems.get(fsid)
    if (root) allNids.push(root.nid)
    for (const [nid, node] of this.meta) {
      if (node.fsid === fsid && node.type !== 'root') allNids.push(nid)
    }

    let start = 0
    if (cursor) {
      const idx = allNids.indexOf(cursor)
      if (idx >= 0) start = idx + 1
    }

    const slice = allNids.slice(start, start + limit)
    const nextCursor = start + limit < allNids.length ? allNids[start + limit] : null
    return { nids: slice, cursor: nextCursor }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async putSession(session: Session): Promise<void> {
    this.sessions.set(session.session_id, session)
  }

  async deleteSession(sessionId: string): Promise<void> {
    this._revokedSessions.add(sessionId)
    this.sessions.delete(sessionId)
  }

  async listExpiredNodes(before: Date): Promise<string[]> {
    const result: string[] = []
    for (const [nid, node] of this.meta) {
      if (node.type !== 'root' && node.ttl !== null) {
        const created = new Date(node.created_at).getTime()
        if (created + node.ttl * 1000 < before.getTime()) result.push(nid)
      }
    }
    return result
  }

  async listExpiredFS(before: Date): Promise<string[]> {
    const result: string[] = []
    for (const [fsid, root] of this.filesystems) {
      if (root.ttl !== null) {
        const created = new Date(root.created_at).getTime()
        if (created + root.ttl * 1000 < before.getTime()) result.push(fsid)
      }
    }
    return result
  }

  listAllFS(): RootMetaNode[] {
    return Array.from(this.filesystems.values())
  }
}
