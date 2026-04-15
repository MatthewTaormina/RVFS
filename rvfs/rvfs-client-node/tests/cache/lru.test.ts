/**
 * §11.1 — LRU in-memory node cache.
 *
 * Tests eviction policy, hit/miss tracking, stale-while-revalidate
 * semantics, and the path→nid index that backs stat() calls.
 *
 * These tests will fail until Sam implements LruCache in src/cache/lru.ts.
 *
 * Spec sections: §11.1 (LRU cache), §11.2 (stale-while-revalidate)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { MetaNode, FileMetaNode } from 'rvfs-types'

// @ts-ignore — stub exports {} until implemented
import { LruCache } from '../../src/cache/lru.js'

// ── helpers ────────────────────────────────────────────────────────────────

function makeFileNode(nid: string, name: string, fsid = 'fs-test'): FileMetaNode {
  const now = new Date().toISOString()
  return {
    nid,
    type: 'file',
    name,
    parent_nid: null,
    fsid,
    created_at: now,
    updated_at: now,
    ttl: null,
    meta: {
      mode: 0o644, uid: 1000, gid: 1000,
      atime: now, mtime: now, ctime: now,
      nlink: 1, inode: Math.floor(Math.random() * 2 ** 32),
    },
    blob_nid: null,
    size: 0,
    symlink_target: null,
  }
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('LruCache', () => {
  let cache: InstanceType<typeof LruCache>

  beforeEach(() => {
    cache = new LruCache({ maxNodes: 3, maxBlobBytes: 1024 * 1024 })
  })

  // ── §11.1 Basic get / set ────────────────────────────────────────────────

  it('stores and retrieves a meta node by nid', () => {
    const node = makeFileNode('n-001', 'foo.txt')
    cache.setNode(node.nid, node)
    expect(cache.getNode('n-001')).toEqual(node)
  })

  it('returns undefined for a cache miss', () => {
    expect(cache.getNode('n-not-there')).toBeUndefined()
  })

  it('stores and retrieves blob data by nid', () => {
    const data = new Uint8Array([1, 2, 3, 4])
    cache.setBlob('b-001', data)
    expect(cache.getBlob('b-001')).toEqual(data)
  })

  it('returns undefined for a blob cache miss', () => {
    expect(cache.getBlob('b-not-there')).toBeUndefined()
  })

  // ── §11.1 LRU eviction ───────────────────────────────────────────────────

  it('evicts the least recently used node when maxNodes is exceeded', () => {
    // Fill to capacity: n-1, n-2, n-3
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.setNode('n-2', makeFileNode('n-2', 'b.txt'))
    cache.setNode('n-3', makeFileNode('n-3', 'c.txt'))
    // Access n-1 and n-2 to make n-3 the LRU... wait, access order is n-1, n-2 were older
    // n-3 was most recently set, so LRU is n-1
    // Insert n-4 → should evict n-1
    cache.setNode('n-4', makeFileNode('n-4', 'd.txt'))
    expect(cache.getNode('n-1')).toBeUndefined()
    expect(cache.getNode('n-4')).toBeDefined()
  })

  it('updates LRU order on access — accessed node survives eviction', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.setNode('n-2', makeFileNode('n-2', 'b.txt'))
    cache.setNode('n-3', makeFileNode('n-3', 'c.txt'))
    // Access n-1 to make it recently used
    cache.getNode('n-1')
    // Insert n-4 → LRU is now n-2 (n-1 was touched, n-3 is most recent, n-2 is oldest)
    cache.setNode('n-4', makeFileNode('n-4', 'd.txt'))
    expect(cache.getNode('n-2')).toBeUndefined()
    expect(cache.getNode('n-1')).toBeDefined()
  })

  it('increments evictions counter on each eviction', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.setNode('n-2', makeFileNode('n-2', 'b.txt'))
    cache.setNode('n-3', makeFileNode('n-3', 'c.txt'))
    const before = cache.stats().evictions
    cache.setNode('n-4', makeFileNode('n-4', 'd.txt')) // triggers eviction
    expect(cache.stats().evictions).toBe(before + 1)
  })

  // ── §11.1 Blob byte-size eviction ────────────────────────────────────────

  it('evicts blobs when maxBlobBytes is exceeded', () => {
    const small = new LruCache({ maxNodes: 100, maxBlobBytes: 10 })
    const data6 = new Uint8Array(6)
    const data6b = new Uint8Array(6)
    small.setBlob('b-1', data6)
    small.setBlob('b-2', data6b) // 12 bytes total → b-1 should be evicted
    expect(small.getBlob('b-1')).toBeUndefined()
    expect(small.getBlob('b-2')).toBeDefined()
  })

  // ── §11.1 Stats ──────────────────────────────────────────────────────────

  it('tracks hits and misses correctly', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.getNode('n-1') // hit
    cache.getNode('n-1') // hit
    cache.getNode('n-99') // miss
    const s = cache.stats()
    expect(s.hits).toBe(2)
    expect(s.misses).toBe(1)
  })

  it('sizeNodes reflects number of cached nodes', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.setNode('n-2', makeFileNode('n-2', 'b.txt'))
    expect(cache.stats().sizeNodes).toBe(2)
  })

  it('sizeBlobBytes reflects total bytes of cached blobs', () => {
    const data = new Uint8Array(128)
    cache.setBlob('b-1', data)
    expect(cache.stats().sizeBlobBytes).toBe(128)
  })

  // ── §11.1 Delete ─────────────────────────────────────────────────────────

  it('deletes a node from the cache', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.deleteNode('n-1')
    expect(cache.getNode('n-1')).toBeUndefined()
  })

  it('deletes a blob from the cache', () => {
    cache.setBlob('b-1', new Uint8Array(16))
    cache.deleteBlob('b-1')
    expect(cache.getBlob('b-1')).toBeUndefined()
  })

  // ── §11.1 Clear ───────────────────────────────────────────────────────────

  it('clear() removes all nodes and blobs', () => {
    cache.setNode('n-1', makeFileNode('n-1', 'a.txt'))
    cache.setBlob('b-1', new Uint8Array(8))
    cache.clear()
    expect(cache.getNode('n-1')).toBeUndefined()
    expect(cache.getBlob('b-1')).toBeUndefined()
    expect(cache.stats().sizeNodes).toBe(0)
    expect(cache.stats().sizeBlobBytes).toBe(0)
  })

  // ── §11.2 Stale-while-revalidate ─────────────────────────────────────────

  it('getNodeStale() returns a node even past its soft expiry', () => {
    const node = makeFileNode('n-stale', 'old.txt')
    // set with a very short TTL hint (past already)
    cache.setNode('n-stale', node, { ttlMs: -1000 }) // already expired
    // stale read should still return it
    const result = cache.getNodeStale('n-stale')
    expect(result).toBeDefined()
    expect(result!.node).toEqual(node)
    expect(result!.stale).toBe(true)
  })

  it('getNode() returns undefined for a soft-expired node', () => {
    const node = makeFileNode('n-expired', 'past.txt')
    cache.setNode('n-expired', node, { ttlMs: -1000 }) // already expired
    // strict read should return undefined
    expect(cache.getNode('n-expired')).toBeUndefined()
  })

  it('non-expired node is not marked stale', () => {
    const node = makeFileNode('n-fresh', 'fresh.txt')
    cache.setNode('n-fresh', node, { ttlMs: 60_000 })
    const result = cache.getNodeStale('n-fresh')
    expect(result).toBeDefined()
    expect(result!.stale).toBe(false)
  })
})
