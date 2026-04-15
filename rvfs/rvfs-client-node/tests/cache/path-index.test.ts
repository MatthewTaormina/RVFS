/**
 * §11.1 — Path→nid index (the cache's path index layer).
 *
 * The path index maps resolved VFS paths to nids so that stat() calls
 * for the same path bypass the O(n) node-walk and hit the LRU directly.
 *
 * Tests will fail until Sam implements PathIndex in src/cache/lru.ts
 * (or a dedicated module if the architect separates them).
 *
 * Spec sections: §11.1 (path index), §4 (path resolution)
 */

import { describe, it, expect, beforeEach } from 'vitest'

// @ts-ignore — stub exports {} until implemented
import { PathIndex } from '../../src/cache/lru.js'

describe('PathIndex', () => {
  let index: InstanceType<typeof PathIndex>

  beforeEach(() => {
    index = new PathIndex()
  })

  // ── Basic set / get ───────────────────────────────────────────────────────

  it('stores a path→nid mapping', () => {
    index.set('/home/user/file.txt', 'n-abc')
    expect(index.get('/home/user/file.txt')).toBe('n-abc')
  })

  it('returns undefined for an unmapped path', () => {
    expect(index.get('/not/mapped')).toBeUndefined()
  })

  it('overwrites an existing mapping', () => {
    index.set('/a/b.txt', 'n-old')
    index.set('/a/b.txt', 'n-new')
    expect(index.get('/a/b.txt')).toBe('n-new')
  })

  // ── Delete ────────────────────────────────────────────────────────────────

  it('deletes a mapping by path', () => {
    index.set('/delete-me.txt', 'n-xyz')
    index.delete('/delete-me.txt')
    expect(index.get('/delete-me.txt')).toBeUndefined()
  })

  it('delete is a no-op for unmapped paths', () => {
    expect(() => index.delete('/not-there')).not.toThrow()
  })

  // ── Prefix invalidation ───────────────────────────────────────────────────

  it('invalidatePrefix() removes all paths under a directory', () => {
    index.set('/data/a.txt', 'n-1')
    index.set('/data/b.txt', 'n-2')
    index.set('/data/sub/c.txt', 'n-3')
    index.set('/other/d.txt', 'n-4')
    index.invalidatePrefix('/data')
    expect(index.get('/data/a.txt')).toBeUndefined()
    expect(index.get('/data/b.txt')).toBeUndefined()
    expect(index.get('/data/sub/c.txt')).toBeUndefined()
    expect(index.get('/other/d.txt')).toBe('n-4')
  })

  it('invalidatePrefix() with root "/" clears all entries', () => {
    index.set('/a.txt', 'n-1')
    index.set('/b.txt', 'n-2')
    index.invalidatePrefix('/')
    expect(index.get('/a.txt')).toBeUndefined()
    expect(index.get('/b.txt')).toBeUndefined()
  })

  it('invalidatePrefix() is a no-op when prefix has no entries', () => {
    index.set('/keep.txt', 'n-1')
    expect(() => index.invalidatePrefix('/nothing-here')).not.toThrow()
    expect(index.get('/keep.txt')).toBe('n-1')
  })

  // ── Bulk invalidation by nid ──────────────────────────────────────────────

  it('invalidateNid() removes all paths that map to a given nid', () => {
    index.set('/a.txt', 'n-shared')
    index.set('/b.txt', 'n-shared') // same nid, different path (rare but possible)
    index.set('/c.txt', 'n-other')
    index.invalidateNid('n-shared')
    expect(index.get('/a.txt')).toBeUndefined()
    expect(index.get('/b.txt')).toBeUndefined()
    expect(index.get('/c.txt')).toBe('n-other')
  })

  // ── Clear ─────────────────────────────────────────────────────────────────

  it('clear() removes all entries', () => {
    index.set('/x.txt', 'n-1')
    index.set('/y.txt', 'n-2')
    index.clear()
    expect(index.get('/x.txt')).toBeUndefined()
    expect(index.get('/y.txt')).toBeUndefined()
  })

  // ── Size ──────────────────────────────────────────────────────────────────

  it('size reflects the number of mapped entries', () => {
    expect(index.size).toBe(0)
    index.set('/a.txt', 'n-1')
    expect(index.size).toBe(1)
    index.set('/b.txt', 'n-2')
    expect(index.size).toBe(2)
    index.delete('/a.txt')
    expect(index.size).toBe(1)
  })
})
