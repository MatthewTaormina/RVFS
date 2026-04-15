/**
 * §10 — IRvfsClient full method coverage via SystemRvfsClient.
 *
 * Tests every method declared in IRvfsClient. These tests will fail until
 * Sam implements SystemRvfsClient in src/client.ts.
 *
 * Spec sections: §10.0–10.9, §13 (errors), §14.4 (path traversal)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { IRvfsClient } from 'rvfs-types'
import { RvfsError } from 'rvfs-types'

// @ts-ignore — stub exports {} until implemented
import { SystemRvfsClient } from '../src/client.js'
import { startMockServer, makeConfig, type MockServerHandle } from './setup.js'

// ── helpers ────────────────────────────────────────────────────────────────

function makeClient(handle: MockServerHandle, overrides = {}): IRvfsClient {
  return new SystemRvfsClient(makeConfig(handle, overrides))
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('SystemRvfsClient', () => {
  let handle: MockServerHandle
  let client: IRvfsClient

  beforeEach(async () => {
    handle = await startMockServer()
    client = makeClient(handle)
  })

  afterEach(async () => {
    try { await client.unmount() } catch { /* ignore if never mounted */ }
    await handle.close()
  })

  // ── §10.1 Constructor / config ───────────────────────────────────────────

  it('can be instantiated with a valid RvfsClientConfig', () => {
    expect(client).toBeDefined()
    expect(typeof client.mount).toBe('function')
  })

  it('exposes an "online" boolean property', () => {
    expect(typeof client.online).toBe('boolean')
  })

  // ── §10.2 Lifecycle ──────────────────────────────────────────────────────

  it('mount() resolves without error', async () => {
    await expect(client.mount()).resolves.toBeUndefined()
  })

  it('unmount() resolves without error after mount()', async () => {
    await client.mount()
    await expect(client.unmount()).resolves.toBeUndefined()
  })

  it('client is online after mount()', async () => {
    await client.mount()
    expect(client.online).toBe(true)
  })

  it('client is offline after unmount()', async () => {
    await client.mount()
    await client.unmount()
    expect(client.online).toBe(false)
  })

  // ── §10.3 Read operations ────────────────────────────────────────────────

  describe('stat()', () => {
    it('returns a FileMetaNode for an existing file', async () => {
      await client.mount()
      // create a file first via writeText
      await client.writeText('/hello.txt', 'hello')
      const node = await client.stat('/hello.txt')
      expect(node.type).toBe('file')
      expect(node.name).toBe('hello.txt')
      expect(typeof node.nid).toBe('string')
      expect(typeof node.meta).toBe('object')
    })

    it('returns a DirMetaNode for an existing directory', async () => {
      await client.mount()
      await client.mkdir('/mydir')
      const node = await client.stat('/mydir')
      expect(node.type).toBe('dir')
      expect(node.name).toBe('mydir')
    })

    it('throws RvfsError(ENOENT) for a missing path', async () => {
      await client.mount()
      await expect(client.stat('/does-not-exist')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })

    it('throws RvfsError(EINVAL) for a path traversal attempt', async () => {
      await client.mount()
      await expect(client.stat('/../../etc/passwd')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && (e.code === 'EINVAL' || e.code === 'ENOENT'),
      )
    })
  })

  describe('readText()', () => {
    it('returns the content of an existing file', async () => {
      await client.mount()
      await client.writeText('/readme.txt', 'hello world')
      const content = await client.readText('/readme.txt')
      expect(content).toBe('hello world')
    })

    it('throws RvfsError(ENOENT) for a missing file', async () => {
      await client.mount()
      await expect(client.readText('/missing.txt')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })

    it('throws RvfsError for a directory path', async () => {
      await client.mount()
      await client.mkdir('/somedir')
      await expect(client.readText('/somedir')).rejects.toBeInstanceOf(RvfsError)
    })
  })

  describe('readBinary()', () => {
    it('returns Uint8Array with the file content', async () => {
      await client.mount()
      await client.writeText('/bin.txt', 'binary-data')
      const result = await client.readBinary('/bin.txt')
      expect(result).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(result)).toBe('binary-data')
    })

    it('throws RvfsError(ENOENT) for a missing file', async () => {
      await client.mount()
      await expect(client.readBinary('/nope.bin')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })
  })

  describe('readdir()', () => {
    it('returns entry names for a directory', async () => {
      await client.mount()
      await client.writeText('/file-a.txt', 'a')
      await client.writeText('/file-b.txt', 'b')
      const entries = await client.readdir('/')
      expect(entries).toContain('file-a.txt')
      expect(entries).toContain('file-b.txt')
    })

    it('throws RvfsError(ENOENT) for a missing directory', async () => {
      await client.mount()
      await expect(client.readdir('/missing-dir')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })

    it('throws RvfsError(ENOTDIR) for a file path', async () => {
      await client.mount()
      await client.writeText('/just-a-file.txt', 'x')
      await expect(client.readdir('/just-a-file.txt')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && (e.code === 'ENOTDIR' || e.code === 'EISDIR'),
      )
    })
  })

  describe('readdirWithTypes()', () => {
    it('returns entries with name and stat', async () => {
      await client.mount()
      await client.writeText('/typed.txt', 'data')
      const entries = await client.readdirWithTypes('/')
      const entry = entries.find(e => e.name === 'typed.txt')
      expect(entry).toBeDefined()
      expect(entry!.stat.type).toBe('file')
    })
  })

  describe('exists()', () => {
    it('returns true for an existing path', async () => {
      await client.mount()
      await client.writeText('/exists.txt', 'yes')
      expect(await client.exists('/exists.txt')).toBe(true)
    })

    it('returns false for a missing path', async () => {
      await client.mount()
      expect(await client.exists('/no-such-file.txt')).toBe(false)
    })
  })

  describe('isFile()', () => {
    it('returns true for a file', async () => {
      await client.mount()
      await client.writeText('/f.txt', 'x')
      expect(await client.isFile('/f.txt')).toBe(true)
    })

    it('returns false for a directory', async () => {
      await client.mount()
      await client.mkdir('/mydir2')
      expect(await client.isFile('/mydir2')).toBe(false)
    })

    it('returns false for a missing path', async () => {
      await client.mount()
      expect(await client.isFile('/missing')).toBe(false)
    })
  })

  describe('isDir()', () => {
    it('returns true for a directory', async () => {
      await client.mount()
      await client.mkdir('/ddir')
      expect(await client.isDir('/ddir')).toBe(true)
    })

    it('returns false for a file', async () => {
      await client.mount()
      await client.writeText('/notdir.txt', 'x')
      expect(await client.isDir('/notdir.txt')).toBe(false)
    })

    it('returns false for a missing path', async () => {
      await client.mount()
      expect(await client.isDir('/not-here')).toBe(false)
    })
  })

  describe('realpath()', () => {
    it('returns the canonical path of an existing node', async () => {
      await client.mount()
      await client.writeText('/canonical.txt', 'x')
      const rp = await client.realpath('/canonical.txt')
      expect(rp).toBe('/canonical.txt')
    })

    it('throws RvfsError(ENOENT) for a missing path', async () => {
      await client.mount()
      await expect(client.realpath('/not-there')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })
  })

  // ── §10.4 Write operations ───────────────────────────────────────────────

  describe('writeText()', () => {
    it('creates a new file with the given content', async () => {
      await client.mount()
      await client.writeText('/new-file.txt', 'content here')
      const text = await client.readText('/new-file.txt')
      expect(text).toBe('content here')
    })

    it('overwrites an existing file', async () => {
      await client.mount()
      await client.writeText('/overwrite.txt', 'first')
      await client.writeText('/overwrite.txt', 'second')
      expect(await client.readText('/overwrite.txt')).toBe('second')
    })

    it('respects noClobber — throws RvfsError(EEXIST) if file exists', async () => {
      await client.mount()
      await client.writeText('/noclobber.txt', 'original')
      await expect(
        client.writeText('/noclobber.txt', 'new', { noClobber: true }),
      ).rejects.toSatisfy((e: unknown) => e instanceof RvfsError && e.code === 'EEXIST')
    })

    it('applies mode option on creation', async () => {
      await client.mount()
      await client.writeText('/mode-test.txt', 'x', { mode: 0o600 })
      const node = await client.stat('/mode-test.txt')
      if (node.type === 'file') {
        expect(node.meta.mode & 0o777).toBe(0o600)
      }
    })

    it('rejects path traversal — §14.4', async () => {
      await client.mount()
      await expect(
        client.writeText('/../../etc/cron.d/evil', 'x'),
      ).rejects.toBeInstanceOf(RvfsError)
    })
  })

  describe('writeBinary()', () => {
    it('creates a file with binary content', async () => {
      await client.mount()
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      await client.writeBinary('/binary.bin', data)
      const result = await client.readBinary('/binary.bin')
      expect(result).toEqual(data)
    })
  })

  describe('appendText()', () => {
    it('appends to an existing file', async () => {
      await client.mount()
      await client.writeText('/append.txt', 'line1\n')
      await client.appendText('/append.txt', 'line2\n')
      const content = await client.readText('/append.txt')
      expect(content).toBe('line1\nline2\n')
    })
  })

  // ── §10.5 Directory operations ───────────────────────────────────────────

  describe('mkdir()', () => {
    it('creates a new directory', async () => {
      await client.mount()
      await client.mkdir('/newdir')
      expect(await client.isDir('/newdir')).toBe(true)
    })

    it('throws RvfsError(EEXIST) if directory already exists', async () => {
      await client.mount()
      await client.mkdir('/dup-dir')
      await expect(client.mkdir('/dup-dir')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'EEXIST',
      )
    })

    it('creates parent directories with parents: true', async () => {
      await client.mount()
      await client.mkdir('/deep/nested/dir', { parents: true })
      expect(await client.isDir('/deep/nested/dir')).toBe(true)
    })
  })

  describe('rmdir()', () => {
    it('removes an empty directory', async () => {
      await client.mount()
      await client.mkdir('/to-remove')
      await client.rmdir('/to-remove')
      expect(await client.exists('/to-remove')).toBe(false)
    })

    it('throws RvfsError(ENOTEMPTY) for non-empty directory without recursive', async () => {
      await client.mount()
      await client.mkdir('/non-empty')
      await client.writeText('/non-empty/child.txt', 'x')
      await expect(client.rmdir('/non-empty')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOTEMPTY',
      )
    })

    it('removes non-empty directory with recursive: true', async () => {
      await client.mount()
      await client.mkdir('/recursive-rm')
      await client.writeText('/recursive-rm/child.txt', 'x')
      await client.rmdir('/recursive-rm', { recursive: true })
      expect(await client.exists('/recursive-rm')).toBe(false)
    })
  })

  // ── §10.5 File management ────────────────────────────────────────────────

  describe('rm()', () => {
    it('removes an existing file', async () => {
      await client.mount()
      await client.writeText('/remove-me.txt', 'bye')
      await client.rm('/remove-me.txt')
      expect(await client.exists('/remove-me.txt')).toBe(false)
    })

    it('throws RvfsError(ENOENT) for missing file without force', async () => {
      await client.mount()
      await expect(client.rm('/no-file')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })

    it('succeeds silently with force: true for missing file', async () => {
      await client.mount()
      await expect(client.rm('/missing', { force: true })).resolves.toBeUndefined()
    })
  })

  describe('mv()', () => {
    it('moves a file to a new path', async () => {
      await client.mount()
      await client.writeText('/src.txt', 'movable')
      await client.mv('/src.txt', '/dst.txt')
      expect(await client.exists('/src.txt')).toBe(false)
      expect(await client.exists('/dst.txt')).toBe(true)
      expect(await client.readText('/dst.txt')).toBe('movable')
    })

    it('throws RvfsError(ENOENT) for missing source', async () => {
      await client.mount()
      await expect(client.mv('/no-src', '/dst')).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })
  })

  describe('cp()', () => {
    it('copies a file to a new path', async () => {
      await client.mount()
      await client.writeText('/original.txt', 'copy me')
      await client.cp('/original.txt', '/copy.txt')
      expect(await client.exists('/original.txt')).toBe(true)
      expect(await client.readText('/copy.txt')).toBe('copy me')
    })
  })

  describe('symlink()', () => {
    it('creates a symlink node', async () => {
      await client.mount()
      await client.writeText('/target.txt', 'linked')
      await client.symlink('/target.txt', '/link.txt')
      const node = await client.stat('/link.txt')
      if (node.type === 'file') {
        expect(node.symlink_target).toBe('/target.txt')
      }
    })
  })

  // ── §10.6 Metadata ───────────────────────────────────────────────────────

  describe('chmod()', () => {
    it('updates the mode on an existing node', async () => {
      await client.mount()
      await client.writeText('/chmodme.txt', 'x')
      await client.chmod('/chmodme.txt', 0o600)
      const node = await client.stat('/chmodme.txt')
      if (node.type === 'file') {
        expect(node.meta.mode & 0o777).toBe(0o600)
      }
    })

    it('throws RvfsError(ENOENT) for missing path', async () => {
      await client.mount()
      await expect(client.chmod('/ghost', 0o644)).rejects.toSatisfy(
        (e: unknown) => e instanceof RvfsError && e.code === 'ENOENT',
      )
    })
  })

  describe('chown()', () => {
    it('updates uid and gid on an existing node', async () => {
      await client.mount()
      await client.writeText('/chownme.txt', 'x')
      await client.chown('/chownme.txt', 500, 500)
      const node = await client.stat('/chownme.txt')
      if (node.type === 'file') {
        expect(node.meta.uid).toBe(500)
        expect(node.meta.gid).toBe(500)
      }
    })
  })

  describe('utimes()', () => {
    it('updates atime and mtime on an existing node', async () => {
      await client.mount()
      await client.writeText('/utimes.txt', 'x')
      const atime = new Date('2025-01-01T00:00:00.000Z')
      const mtime = new Date('2025-06-01T00:00:00.000Z')
      await expect(client.utimes('/utimes.txt', atime, mtime)).resolves.toBeUndefined()
      const node = await client.stat('/utimes.txt')
      if (node.type === 'file') {
        expect(node.meta.atime).toBe(atime.toISOString())
        expect(node.meta.mtime).toBe(mtime.toISOString())
      }
    })
  })

  // ── §10.7 Cache control ──────────────────────────────────────────────────

  describe('invalidate()', () => {
    it('does not throw when called with valid paths', async () => {
      await client.mount()
      expect(() => client.invalidate('/some/path')).not.toThrow()
    })

    it('invalidates multiple paths without error', async () => {
      await client.mount()
      expect(() => client.invalidate('/a', '/b', '/c')).not.toThrow()
    })
  })

  describe('prefetch()', () => {
    it('resolves without error', async () => {
      await client.mount()
      await expect(client.prefetch('/')).resolves.toBeUndefined()
    })
  })

  describe('cacheStats()', () => {
    it('returns a CacheStats object with numeric fields', async () => {
      await client.mount()
      const stats = client.cacheStats()
      expect(typeof stats.hits).toBe('number')
      expect(typeof stats.misses).toBe('number')
      expect(typeof stats.evictions).toBe('number')
      expect(typeof stats.sizeNodes).toBe('number')
      expect(typeof stats.sizeBlobBytes).toBe('number')
    })

    it('hits count increases after reading a cached node twice', async () => {
      await client.mount()
      await client.writeText('/cache-test.txt', 'x')
      await client.readText('/cache-test.txt')
      const before = client.cacheStats().hits
      await client.readText('/cache-test.txt') // should hit cache
      const after = client.cacheStats().hits
      expect(after).toBeGreaterThan(before)
    })
  })

  // ── §10.8 Session management ─────────────────────────────────────────────

  describe('renewSession()', () => {
    it('extends session TTL without error', async () => {
      await client.mount()
      await expect(client.renewSession(7200)).resolves.toBeUndefined()
    })
  })

  describe('endSession()', () => {
    it('terminates the session without error', async () => {
      await client.mount()
      await expect(client.endSession()).resolves.toBeUndefined()
    })
  })

  // ── §10.8 Change stream ──────────────────────────────────────────────────

  describe('watch()', () => {
    it('returns an unsubscribe function', async () => {
      await client.mount()
      const unsub = client.watch(() => {})
      expect(typeof unsub).toBe('function')
      unsub()
    })

    it('unsubscribes cleanly without error', async () => {
      await client.mount()
      const unsub = client.watch(() => {})
      expect(() => unsub()).not.toThrow()
    })
  })

  describe('watchPath()', () => {
    it('returns an unsubscribe function for a specific path', async () => {
      await client.mount()
      const unsub = client.watchPath('/some/path', () => {})
      expect(typeof unsub).toBe('function')
      unsub()
    })

    it('returns an unsubscribe function for a glob pattern', async () => {
      await client.mount()
      const unsub = client.watchPath('/**/*.ts', () => {})
      expect(typeof unsub).toBe('function')
      unsub()
    })
  })

  // ── §10.9 Offline & WAL ──────────────────────────────────────────────────

  describe('on()', () => {
    it('registers an event listener without throwing', async () => {
      expect(() => client.on('online', () => {})).not.toThrow()
      expect(() => client.on('offline', () => {})).not.toThrow()
      expect(() => client.on('sync:start', () => {})).not.toThrow()
      expect(() => client.on('sync:complete', () => {})).not.toThrow()
      expect(() => client.on('sync:error', () => {})).not.toThrow()
      expect(() => client.on('change', () => {})).not.toThrow()
    })
  })

  describe('sync()', () => {
    it('returns a SyncResult with numeric counters', async () => {
      await client.mount()
      const result = await client.sync()
      expect(typeof result.applied).toBe('number')
      expect(typeof result.conflicts).toBe('number')
      expect(typeof result.errors).toBe('number')
      expect(typeof result.skipped).toBe('number')
    })

    it('returns applied=0 when there are no pending writes', async () => {
      await client.mount()
      const result = await client.sync()
      expect(result.applied).toBe(0)
    })
  })

  describe('getPendingWrites()', () => {
    it('returns an array (empty when nothing is pending)', async () => {
      await client.mount()
      const pending = await client.getPendingWrites()
      expect(Array.isArray(pending)).toBe(true)
    })
  })

  describe('discardPendingWrite()', () => {
    it('throws RvfsError for an unknown write ID', async () => {
      await client.mount()
      await expect(client.discardPendingWrite('unknown-id')).rejects.toBeInstanceOf(RvfsError)
    })
  })
})
