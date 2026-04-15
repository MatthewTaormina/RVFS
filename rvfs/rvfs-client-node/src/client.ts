import { createHash } from 'node:crypto'
import type {
  IRvfsClient, RvfsClientConfig, WriteOptions, CacheStats, SyncResult,
  PendingWrite, RvfsClientEvent, RvfsEvent, RvfsChangeEvent,
  FileMetaNode, DirMetaNode, MetaNode,
} from 'rvfs-types'
import { RvfsError } from 'rvfs-types'
import { LruCache, PathIndex } from './cache/lru.js'
import { MemoryWal } from './wal/memory.js'
import { RvfsHttp, isNetworkError } from './http.js'
import { SseClient } from './sse.js'
import { syncWal } from './sync.js'

// ── Internal config (extends public) ─────────────────────────────────────────
export interface SystemRvfsClientConfig extends RvfsClientConfig {
  forkOf?: string | null
}

// Content cache key: keyed by path so invalidation is straightforward
const contentKey = (path: string): string => 'content:' + path

type DirLike = (DirMetaNode | (MetaNode & { type: 'root' })) & {
  name_index: Record<string, string>
  children: string[]
}

// ── SystemRvfsClient ──────────────────────────────────────────────────────────
export class SystemRvfsClient implements IRvfsClient {
  private readonly config: SystemRvfsClientConfig
  private readonly fsid: string
  private readonly forkOf: string | null
  private readonly http: RvfsHttp
  private readonly cache: LruCache
  private readonly pathIndex: PathIndex
  private readonly wal: MemoryWal
  private readonly tombstones = new Set<string>() // paths deleted from fork that exist in parent
  private sse: SseClient | null = null
  private _online = false
  private readonly eventListeners = new Map<string, Set<(e: RvfsEvent) => void>>()

  // ── Constructor ─────────────────────────────────────────────────────────────
  constructor(config: SystemRvfsClientConfig) {
    this.config = config
    this.fsid = config.fsid
    this.forkOf = config.forkOf ?? null
    this.http = new RvfsHttp(config.baseUrl, config.sessionId ?? '')
    this.cache = new LruCache({
      maxNodes: config.cacheMaxNodes ?? 256,
      maxBlobBytes: (config.cacheMaxBlobMb ?? 32) * 1024 * 1024,
    })
    this.pathIndex = new PathIndex()
    this.wal = new MemoryWal()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  async mount(): Promise<void> {
    try {
      await this.http.get<unknown>('/ping')
      this._online = true
    } catch {
      this._online = false
    }
    if (this._online && this.config.watchOnMount !== false) {
      await this.openSse()
    }
  }

  async unmount(): Promise<void> {
    this.sse?.close()
    this.sse = null
    this._online = false
  }

  get online(): boolean { return this._online }

  // ── SSE ───────────────────────────────────────────────────────────────────────
  private async openSse(): Promise<void> {
    const sse = new SseClient(this.http, this.fsid)
    sse.setOnReset(() => {
      this.cache.clear()
      this.pathIndex.clear()
    })
    sse.setOnEvent((event) => {
      // Invalidate cache for affected path
      if (event.path) {
        const nid = this.pathIndex.get(event.path)
        if (nid) { this.cache.deleteNode(nid); this.cache.deleteBlob('content:' + nid) }
        this.pathIndex.delete(event.path)
      }
      if (event.nid) {
        this.cache.deleteNode(event.nid)
        this.cache.deleteBlob('content:' + event.nid)
        this.pathIndex.invalidateNid(event.nid)
      }
      this.emitEvent({ type: 'change', event })
    })
    this.sse = sse
    try { await sse.connect() } catch { /* SSE is optional */ }
  }

  // ── Event emitter ─────────────────────────────────────────────────────────────
  on(event: RvfsClientEvent, handler: (e: RvfsEvent) => void): void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set())
    this.eventListeners.get(event)!.add(handler)
  }

  private emitEvent(event: RvfsEvent): void {
    const handlers = this.eventListeners.get(event.type)
    if (handlers) for (const h of handlers) h(event)
  }

  // ── Offline handling ──────────────────────────────────────────────────────────
  private handleNetworkError(): void {
    if (this._online) {
      this._online = false
      this.emitEvent({ type: 'offline' })
    }
  }

  // ── Path validation ───────────────────────────────────────────────────────────
  private validatePath(path: string): void {
    if (path.includes('..')) {
      throw new RvfsError('EINVAL', 'Path traversal not allowed', { path })
    }
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────────
  private invalidatePathAndNode(path: string, nid?: string): void {
    const resolvedNid = nid ?? this.pathIndex.get(path)
    if (resolvedNid) this.cache.deleteNode(resolvedNid)
    this.cache.deleteBlob(contentKey(path))
    this.pathIndex.delete(path)
  }

  private invalidateParent(path: string): void {
    const lastSlash = path.lastIndexOf('/')
    const parentPath = lastSlash > 0 ? path.slice(0, lastSlash) : '/'
    const parentNid = this.pathIndex.get(parentPath)
    if (parentNid) this.cache.deleteNode(parentNid)
  }

  // ── Tombstone check ───────────────────────────────────────────────────────────
  private isTombstoned(path: string): boolean {
    return this.tombstones.has(normalizePath(path))
  }

  // ── stat (internal — can return any node type) ────────────────────────────────
  private async statRaw(path: string, fsid?: string): Promise<MetaNode> {
    const targetFsid = fsid ?? this.fsid
    const resp = await this.http.post<{ node: MetaNode }>(
      `/fs/${targetFsid}/op/read`, { path },
    )
    return resp.node
  }

  // ── stat ─────────────────────────────────────────────────────────────────────
  async stat(path: string): Promise<FileMetaNode | DirMetaNode> {
    this.validatePath(path)
    if (this.isTombstoned(path)) throw new RvfsError('ENOENT', 'File not found', { path })
    const cachedNid = this.pathIndex.get(path)
    if (cachedNid) {
      const cached = this.cache.getNode(cachedNid)
      if (cached && (cached.type === 'file' || cached.type === 'dir')) {
        return cached as FileMetaNode | DirMetaNode
      }
    }
    try {
      const node = await this.statRaw(path)
      if (node.type === 'file' || node.type === 'dir') {
        this.cache.setNode(node.nid, node)
        this.pathIndex.set(path, node.nid)
        return node as FileMetaNode | DirMetaNode
      }
      throw new RvfsError('EINVAL', 'Unexpected root node', { path })
    } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT' && this.forkOf && !this.isTombstoned(path)) {
        return this.statInFs(path, this.forkOf)
      }
      throw err
    }
  }

  private async statInFs(path: string, fsid: string): Promise<FileMetaNode | DirMetaNode> {
    const node = await this.statRaw(path, fsid)
    if (node.type === 'file' || node.type === 'dir') return node as FileMetaNode | DirMetaNode
    throw new RvfsError('ENOENT', 'Node not found', { path })
  }

  private async statDirect(path: string): Promise<FileMetaNode | DirMetaNode> {
    // Like stat but without fork fall-through
    const node = await this.statRaw(path, this.fsid)
    if (node.type === 'file' || node.type === 'dir') return node as FileMetaNode | DirMetaNode
    throw new RvfsError('ENOENT', 'Node not found', { path })
  }

  // ── Read ─────────────────────────────────────────────────────────────────────
  async readText(path: string): Promise<string> {
    this.validatePath(path)
    const blob = this.cache.getBlob(contentKey(path))
    if (blob) return new TextDecoder().decode(blob)
    if (!this._online) throw new RvfsError('OFFLINE', 'No cached content available', { path })
    try {
      const fsid = await this.resolveFsIdForRead(path)
      const resp = await this.http.post<{ node?: MetaNode; content?: string; encoding?: string; size?: number }>(
        `/fs/${fsid}/op/read`, { path },
      )
      if (resp.content === undefined || resp.content === null) {
        throw new RvfsError('EISDIR', 'Is a directory', { path })
      }
      const content = resp.content
      // Cache the node if included in response
      if (resp.node && (resp.node.type === 'file' || resp.node.type === 'dir')) {
        this.cache.setNode(resp.node.nid, resp.node)
        this.pathIndex.set(path, resp.node.nid)
      }
      this.cache.setBlob(contentKey(path), new TextEncoder().encode(content))
      return content
    } catch (err) {
      if (isNetworkError(err)) {
        this.handleNetworkError()
        throw new RvfsError('OFFLINE', 'Server unreachable', { path })
      }
      throw err
    }
  }

  async readBinary(path: string): Promise<Uint8Array> {
    this.validatePath(path)
    const blob = this.cache.getBlob(contentKey(path))
    if (blob) return decodeBinary(new TextDecoder().decode(blob))
    if (!this._online) throw new RvfsError('OFFLINE', 'No cached content available', { path })
    try {
      const fsid = await this.resolveFsIdForRead(path)
      const resp = await this.http.post<{ node?: MetaNode; content?: string; encoding?: string; size?: number; sha256?: string }>(
        `/fs/${fsid}/op/read`, { path },
      )
      if (resp.content === undefined || resp.content === null) {
        throw new RvfsError('EISDIR', 'Is a directory', { path })
      }
      // W4: Verify blob SHA-256 integrity if server provides hash
      if (resp.sha256) {
        const computed = createHash('sha256').update(resp.content).digest('hex')
        if (computed !== resp.sha256) {
          throw new RvfsError('EIO', 'Blob integrity check failed', { path })
        }
      }
      this.cache.setBlob(contentKey(path), new TextEncoder().encode(resp.content))
      return decodeBinary(resp.content)
    } catch (err) {
      if (isNetworkError(err)) {
        this.handleNetworkError()
        throw new RvfsError('OFFLINE', 'Server unreachable', { path })
      }
      throw err
    }
  }

  async readdir(path: string): Promise<string[]> {
    this.validatePath(path)
    // Fetch dir node (always fresh to get current name_index)
    let node: MetaNode
    try {
      node = await this.statRaw(path, this.fsid)
    } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT' && this.forkOf) {
        node = await this.statRaw(path, this.forkOf)
      } else {
        throw err
      }
    }
    if (node.type === 'file') throw new RvfsError('ENOTDIR', 'Not a directory', { path })
    const dirNode = node as DirLike
    return Object.keys(dirNode.name_index ?? {})
  }

  async readdirWithTypes(path: string): Promise<Array<{ name: string; stat: FileMetaNode | DirMetaNode }>> {
    const names = await this.readdir(path)
    const results: Array<{ name: string; stat: FileMetaNode | DirMetaNode }> = []
    for (const name of names) {
      const childPath = path === '/' ? `/${name}` : `${path}/${name}`
      try {
        const s = await this.stat(childPath)
        results.push({ name, stat: s })
      } catch { /* skip inaccessible */ }
    }
    return results
  }

  async realpath(path: string): Promise<string> {
    this.validatePath(path)
    await this.stat(path) // throws ENOENT if missing
    return normalizePath(path)
  }

  async exists(path: string): Promise<boolean> {
    try { await this.stat(path); return true }
    catch (err) {
      if (err instanceof RvfsError && (err.code === 'ENOENT' || err.code === 'EINVAL')) return false
      throw err
    }
  }

  async isFile(path: string): Promise<boolean> {
    try { const n = await this.stat(path); return n.type === 'file' } catch { return false }
  }

  async isDir(path: string): Promise<boolean> {
    try {
      // Also accept root node (type 'dir' in mock)
      const n = await this.stat(path)
      return n.type === 'dir'
    } catch (err) {
      if (err instanceof RvfsError) return false
      throw err
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────────
  async writeText(path: string, content: string, options?: WriteOptions): Promise<void> {
    this.validatePath(path)
    if (!this._online) {
      await this.handleOfflineWrite('write', path, { content })
      return
    }
    try {
      const result = await this.http.post<{ nid: string; path: string; size: number }>(
        `/fs/${this.fsid}/op/write`,
        { path, content, mode: options?.mode, no_clobber: options?.noClobber ?? false },
      )
      const oldNid = this.pathIndex.get(path)
      if (oldNid && oldNid !== result.nid) this.cache.deleteNode(oldNid)
      this.pathIndex.set(path, result.nid)
      this.cache.deleteNode(result.nid) // force re-stat for updated meta
      this.cache.setBlob(contentKey(path), new TextEncoder().encode(content))
      this.invalidateParent(path)
    } catch (err) {
      if (isNetworkError(err)) {
        this.handleNetworkError()
        await this.handleOfflineWrite('write', path, { content })
        return
      }
      if (err instanceof RvfsError) throw err
      throw new RvfsError('EIO', String(err), { path })
    }
  }

  async writeBinary(path: string, content: Uint8Array, options?: WriteOptions): Promise<void> {
    const encoded = encodeBinary(content)
    await this.writeText(path, encoded, options)
  }

  async appendText(path: string, content: string): Promise<void> {
    this.validatePath(path)
    // Client-side: read + append + write
    let existing = ''
    try { existing = await this.readText(path) } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT') existing = ''
      else throw err
    }
    await this.writeText(path, existing + content)
  }

  private async handleOfflineWrite(
    op: PendingWrite['op'],
    path: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (this.config.offlineFallback === false) {
      throw new RvfsError('OFFLINE', 'Server unreachable and offlineFallback is disabled', { path })
    }
    await this.wal.append({ fsid: this.fsid, op, path, args })
    // Optimistic cache update for writes
    if (op === 'write' && args.content !== undefined) {
      this.cache.setBlob(contentKey(path), new TextEncoder().encode(String(args.content)))
    }
  }

  // ── Directory ─────────────────────────────────────────────────────────────────
  async mkdir(path: string, options?: { parents?: boolean; mode?: number }): Promise<void> {
    this.validatePath(path)
    if (options?.parents) {
      const parts = path.replace(/^\//, '').split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        try {
          await this.http.post(`/fs/${this.fsid}/op/create`, {
            path: current, type: 'dir', meta: { mode: options.mode ?? 0o755 },
          })
          this.invalidateParent(current)
        } catch (err) {
          if (err instanceof RvfsError && err.code === 'EEXIST') continue
          throw err
        }
      }
      return
    }
    await this.http.post(`/fs/${this.fsid}/op/create`, {
      path, type: 'dir', meta: { mode: options?.mode ?? 0o755 },
    })
    this.invalidateParent(path)
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.validatePath(path)
    if (options?.recursive) {
      const entries = await this.readdir(path)
      for (const name of entries) {
        const childPath = path === '/' ? `/${name}` : `${path}/${name}`
        let childIsDir = false
        try { childIsDir = (await this.statDirect(childPath)).type === 'dir' } catch { /* file or gone */ }
        if (childIsDir) {
          await this.rmdir(childPath, { recursive: true })
        } else {
          await this.rm(childPath, { force: true })
        }
      }
    }
    await this.http.post(`/fs/${this.fsid}/op/rm`, { path })
    this.invalidatePathAndNode(path)
    this.invalidateParent(path)
  }

  // ── File management ──────────────────────────────────────────────────────────
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.validatePath(path)
    try {
      await this.http.post(`/fs/${this.fsid}/op/rm`, { path })
      this.invalidatePathAndNode(path)
      this.invalidateParent(path)
    } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT') {
        if (options?.force) return
        // Fork: if the path exists in parent, treat as a tombstone deletion
        if (this.forkOf) {
          try {
            await this.statRaw(path, this.forkOf)
            this.tombstones.add(normalizePath(path))
            return
          } catch { /* not in parent either — fall through to rethrow */ }
        }
      }
      throw err
    }
  }

  async mv(src: string, dst: string): Promise<void> {
    this.validatePath(src)
    this.validatePath(dst)
    await this.http.post(`/fs/${this.fsid}/op/mv`, { src, dst })
    this.invalidatePathAndNode(src)
    this.invalidatePathAndNode(dst)
    this.invalidateParent(src)
    this.invalidateParent(dst)
  }

  async cp(src: string, dst: string, _options?: { recursive?: boolean }): Promise<void> {
    this.validatePath(src)
    this.validatePath(dst)
    const fsid = await this.resolveFsIdForRead(src)
    const resp = await this.http.post<{ content: string }>(
      `/fs/${fsid}/op/read`, { path: src },
    )
    await this.http.post(`/fs/${this.fsid}/op/write`, { path: dst, content: resp.content })
    this.invalidatePathAndNode(dst)
    this.invalidateParent(dst)
  }

  async symlink(target: string, path: string): Promise<void> {
    this.validatePath(path)
    await this.http.post(`/fs/${this.fsid}/op/create`, {
      path, type: 'symlink', symlink_target: target,
    })
    this.invalidateParent(path)
  }

  // ── Metadata ─────────────────────────────────────────────────────────────────
  async chmod(path: string, mode: number): Promise<void> {
    this.validatePath(path)
    const node = await this.stat(path)
    await this.http.patch(`/node/${node.nid}`, { meta: { mode } })
    this.invalidatePathAndNode(path, node.nid)
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    this.validatePath(path)
    const node = await this.stat(path)
    await this.http.patch(`/node/${node.nid}`, { meta: { uid, gid } })
    this.invalidatePathAndNode(path, node.nid)
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    this.validatePath(path)
    const node = await this.stat(path)
    await this.http.patch(`/node/${node.nid}`, {
      meta: { atime: atime.toISOString(), mtime: mtime.toISOString() },
    })
    this.invalidatePathAndNode(path, node.nid)
  }

  // ── Forking ──────────────────────────────────────────────────────────────────
  async fork(options?: { label?: string; ttl?: number }): Promise<IRvfsClient> {
    const result = await this.http.post<{
      fsid: string; fork_of: string; root_nid: string
    }>(`/fs/${this.fsid}/fork`, {
      label: options?.label ?? `fork-of-${this.fsid}`,
      ttl: options?.ttl ?? null,
    })
    const forkedClient = new SystemRvfsClient({
      ...this.config,
      fsid: result.fsid,
      forkOf: result.fork_of,
    })
    await forkedClient.mount()
    return forkedClient
  }

  async isOwned(path: string): Promise<boolean> {
    this.validatePath(path)
    if (!this.forkOf) {
      // Not a fork — everything is owned
      try { await this.statDirect(path); return true }
      catch { return false }
    }
    // Fork: check if path exists directly in this fsid
    try {
      const node = await this.statDirect(path)
      return node.fsid === this.fsid
    } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT') return false
      throw err
    }
  }

  // ── Cache control ────────────────────────────────────────────────────────────
  invalidate(...paths: string[]): void {
    for (const path of paths) {
      const nid = this.pathIndex.get(path)
      if (nid) this.cache.deleteNode(nid)
      this.cache.deleteBlob(contentKey(path))
      this.pathIndex.delete(path)
    }
  }

  async prefetch(dir: string, _depth = 1): Promise<void> {
    try {
      const node = await this.statRaw(dir)
      if (node.type !== 'dir' && node.type !== 'root') return
      const dirNode = node as DirLike
      const nids = (dirNode.children ?? []).filter(nid => !this.cache.getNode(nid))
      for (const nid of nids) {
        try {
          const child = await this.http.get<MetaNode>(`/node/${nid}`)
          this.cache.setNode(nid, child)
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  cacheStats(): CacheStats { return this.cache.stats() }

  // ── Session ──────────────────────────────────────────────────────────────────
  async renewSession(ttlSeconds: number): Promise<void> {
    const sid = this.config.sessionId
    if (!sid) return
    await this.http.patch(`/session/${sid}`, { ttl_seconds: ttlSeconds })
  }

  async endSession(): Promise<void> {
    const sid = this.config.sessionId
    if (!sid) return
    await this.http.delete(`/session/${sid}`)
  }

  // ── Change stream ────────────────────────────────────────────────────────────
  watch(handler: (event: RvfsChangeEvent) => void): () => void {
    if (!this.sse) {
      // Create SSE client lazily for watch calls when not already connected
      this.sse = new SseClient(this.http, this.fsid)
      this.sse.setOnReset(() => { this.cache.clear(); this.pathIndex.clear() })
      this.sse.setOnEvent((event) => { this.emitEvent({ type: 'change', event }) })
    }
    return this.sse.addHandler(handler)
  }

  watchPath(pathOrGlob: string, handler: (event: RvfsChangeEvent) => void): () => void {
    if (!this.sse) {
      this.sse = new SseClient(this.http, this.fsid)
      this.sse.setOnReset(() => { this.cache.clear(); this.pathIndex.clear() })
      this.sse.setOnEvent((event) => { this.emitEvent({ type: 'change', event }) })
    }
    return this.sse.addPathHandler(pathOrGlob, handler)
  }

  // ── Offline & WAL ────────────────────────────────────────────────────────────
  async sync(): Promise<SyncResult> {
    this.emitEvent({ type: 'sync:start' })
    try {
      const result = await syncWal(
        this.http, this.wal, this.fsid,
        this.config.conflictPolicy ?? 'fail',
        (entry, error) => { this.emitEvent({ type: 'sync:error', entry: entry as PendingWrite, error }) },
      )
      this.emitEvent({ type: 'sync:complete', result })
      return result
    } catch (err) {
      const result: SyncResult = { applied: 0, conflicts: 0, errors: 1, skipped: 0 }
      this.emitEvent({ type: 'sync:complete', result })
      throw err
    }
  }

  async getPendingWrites(): Promise<PendingWrite[]> {
    return this.wal.list()
  }

  async discardPendingWrite(id: string): Promise<void> {
    try {
      await this.wal.discard(id)
    } catch {
      throw new RvfsError('ENOENT', `Pending write not found: ${id}`)
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────
  private async resolveFsIdForRead(path: string): Promise<string> {
    if (!this.forkOf) return this.fsid
    try {
      await this.statRaw(path, this.fsid)
      return this.fsid
    } catch (err) {
      if (err instanceof RvfsError && err.code === 'ENOENT') return this.forkOf
      throw err
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const BINARY_PREFIX = '__b64__:'

function encodeBinary(data: Uint8Array): string {
  return BINARY_PREFIX + Buffer.from(data).toString('base64')
}

function decodeBinary(content: string): Uint8Array {
  if (content.startsWith(BINARY_PREFIX)) {
    return new Uint8Array(Buffer.from(content.slice(BINARY_PREFIX.length), 'base64'))
  }
  return new TextEncoder().encode(content)
}

function normalizePath(path: string): string {
  const normalized = ('/' + path).replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

