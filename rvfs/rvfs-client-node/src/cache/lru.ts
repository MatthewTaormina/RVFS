import type { MetaNode, CacheStats } from 'rvfs-types'

// ── Doubly-linked list node ──────────────────────────────────────────────────
interface DllNode<V> {
  key: string
  value: V
  expiresAt: number | null
  prev: DllNode<V> | null
  next: DllNode<V> | null
}

class Dll<V> {
  head: DllNode<V> | null = null
  tail: DllNode<V> | null = null

  addToFront(n: DllNode<V>): void {
    n.prev = null
    n.next = this.head
    if (this.head) this.head.prev = n
    this.head = n
    if (!this.tail) this.tail = n
  }

  remove(n: DllNode<V>): void {
    if (n.prev) n.prev.next = n.next
    else this.head = n.next
    if (n.next) n.next.prev = n.prev
    else this.tail = n.prev
    n.prev = null
    n.next = null
  }

  removeTail(): DllNode<V> | null {
    const t = this.tail
    if (!t) return null
    this.remove(t)
    return t
  }
}

// ── LruCache ──────────────────────────────────────────────────────────────────
export class LruCache {
  private readonly maxNodes: number
  private readonly maxBlobBytes: number

  private nodeMap = new Map<string, DllNode<{ node: MetaNode; expiresAt: number | null }>>()
  private nodeList = new Dll<{ node: MetaNode; expiresAt: number | null }>()

  private blobMap = new Map<string, DllNode<Uint8Array>>()
  private blobList = new Dll<Uint8Array>()
  private blobBytes = 0

  private _hits = 0
  private _misses = 0
  private _evictions = 0

  constructor(opts: { maxNodes: number; maxBlobBytes: number }) {
    this.maxNodes = opts.maxNodes
    this.maxBlobBytes = opts.maxBlobBytes
  }

  // ── Node operations ──────────────────────────────────────────────────────────

  setNode(nid: string, node: MetaNode, opts?: { ttlMs?: number }): void {
    const expiresAt = opts?.ttlMs !== undefined ? Date.now() + opts.ttlMs : null
    const existing = this.nodeMap.get(nid)
    if (existing) this.nodeList.remove(existing)
    const n: DllNode<{ node: MetaNode; expiresAt: number | null }> = {
      key: nid, value: { node, expiresAt }, expiresAt, prev: null, next: null,
    }
    this.nodeList.addToFront(n)
    this.nodeMap.set(nid, n)
    while (this.nodeMap.size > this.maxNodes) {
      const evicted = this.nodeList.removeTail()
      if (evicted) { this.nodeMap.delete(evicted.key); this._evictions++ }
    }
  }

  getNode(nid: string): MetaNode | undefined {
    const entry = this.nodeMap.get(nid)
    if (!entry) { this._misses++; return undefined }
    if (entry.value.expiresAt !== null && Date.now() > entry.value.expiresAt) {
      this._misses++; return undefined
    }
    this.nodeList.remove(entry)
    this.nodeList.addToFront(entry)
    this._hits++
    return entry.value.node
  }

  getNodeStale(nid: string): { node: MetaNode; stale: boolean } | undefined {
    const entry = this.nodeMap.get(nid)
    if (!entry) return undefined
    const stale = entry.value.expiresAt !== null && Date.now() > entry.value.expiresAt
    this.nodeList.remove(entry)
    this.nodeList.addToFront(entry)
    return { node: entry.value.node, stale }
  }

  deleteNode(nid: string): void {
    const entry = this.nodeMap.get(nid)
    if (entry) { this.nodeList.remove(entry); this.nodeMap.delete(nid) }
  }

  // ── Blob operations ──────────────────────────────────────────────────────────

  setBlob(nid: string, data: Uint8Array): void {
    const existing = this.blobMap.get(nid)
    if (existing) {
      this.blobList.remove(existing)
      this.blobBytes -= existing.value.byteLength
    }
    const n: DllNode<Uint8Array> = { key: nid, value: data, expiresAt: null, prev: null, next: null }
    this.blobList.addToFront(n)
    this.blobMap.set(nid, n)
    this.blobBytes += data.byteLength
    while (this.blobBytes > this.maxBlobBytes && this.blobList.tail) {
      const evicted = this.blobList.removeTail()
      if (evicted) {
        this.blobBytes -= evicted.value.byteLength
        this.blobMap.delete(evicted.key)
        this._evictions++
      }
    }
  }

  getBlob(nid: string): Uint8Array | undefined {
    const entry = this.blobMap.get(nid)
    if (!entry) { this._misses++; return undefined }
    this.blobList.remove(entry)
    this.blobList.addToFront(entry)
    this._hits++
    return entry.value
  }

  deleteBlob(nid: string): void {
    const entry = this.blobMap.get(nid)
    if (entry) {
      this.blobList.remove(entry)
      this.blobBytes -= entry.value.byteLength
      this.blobMap.delete(nid)
    }
  }

  clear(): void {
    this.nodeMap.clear()
    this.nodeList.head = null
    this.nodeList.tail = null
    this.blobMap.clear()
    this.blobList.head = null
    this.blobList.tail = null
    this.blobBytes = 0
  }

  stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      sizeNodes: this.nodeMap.size,
      sizeBlobBytes: this.blobBytes,
    }
  }
}

// ── PathIndex ─────────────────────────────────────────────────────────────────
export class PathIndex {
  private pathToNid = new Map<string, string>()
  private nidToPaths = new Map<string, Set<string>>()

  get size(): number { return this.pathToNid.size }

  set(path: string, nid: string): void {
    const oldNid = this.pathToNid.get(path)
    if (oldNid !== undefined) {
      const s = this.nidToPaths.get(oldNid)
      if (s) { s.delete(path); if (s.size === 0) this.nidToPaths.delete(oldNid) }
    }
    this.pathToNid.set(path, nid)
    if (!this.nidToPaths.has(nid)) this.nidToPaths.set(nid, new Set())
    this.nidToPaths.get(nid)!.add(path)
  }

  get(path: string): string | undefined { return this.pathToNid.get(path) }

  delete(path: string): void {
    const nid = this.pathToNid.get(path)
    if (nid === undefined) return
    this.pathToNid.delete(path)
    const s = this.nidToPaths.get(nid)
    if (s) { s.delete(path); if (s.size === 0) this.nidToPaths.delete(nid) }
  }

  invalidatePrefix(prefix: string): void {
    if (prefix === '/') { this.clear(); return }
    for (const path of Array.from(this.pathToNid.keys())) {
      if (path === prefix || path.startsWith(prefix + '/')) this.delete(path)
    }
  }

  invalidateNid(nid: string): void {
    const paths = this.nidToPaths.get(nid)
    if (!paths) return
    for (const path of Array.from(paths)) this.pathToNid.delete(path)
    this.nidToPaths.delete(nid)
  }

  clear(): void {
    this.pathToNid.clear()
    this.nidToPaths.clear()
  }
}

