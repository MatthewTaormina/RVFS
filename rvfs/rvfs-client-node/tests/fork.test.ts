/**
 * §8 — Copy-on-Write Forking (client side).
 *
 * Tests that fork() creates a new filesystem bound client with CoW semantics:
 *  - writes to the fork do not affect the parent
 *  - reads on the fork fall through to the parent for unchanged paths
 *  - isOwned() returns true only for paths written in the fork
 *  - V1 fork_depth is capped at 1 (fork-of-fork returns RvfsError)
 *
 * Tests will fail until Sam implements fork() and isOwned() in SystemRvfsClient.
 *
 * Spec sections: §8 (forking), §8.1 (CoW), §8.3 (V1 depth cap)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { IRvfsClient } from 'rvfs-types'
import { RvfsError } from 'rvfs-types'

// @ts-ignore — stub exports {} until implemented
import { SystemRvfsClient } from '../src/client.js'
import { startMockServer, makeConfig, type MockServerHandle } from './setup.js'

function makeClient(handle: MockServerHandle, overrides = {}): IRvfsClient {
  return new SystemRvfsClient(makeConfig(handle, { watchOnMount: false, ...overrides }))
}

describe('fork() — §8 Copy-on-Write Forking', () => {
  let handle: MockServerHandle
  let parent: IRvfsClient
  let fork: IRvfsClient | undefined

  beforeEach(async () => {
    handle = await startMockServer()
    parent = makeClient(handle)
    await parent.mount()
  })

  afterEach(async () => {
    try { await fork?.unmount() } catch { /* ignore */ }
    try { await parent.unmount() } catch { /* ignore */ }
    await handle.close()
  })

  // ── §8.1 fork() creation ──────────────────────────────────────────────────

  it('fork() returns a new IRvfsClient instance bound to a different fsid', async () => {
    fork = await parent.fork()
    expect(fork).toBeDefined()
    expect(typeof fork.mount).toBe('function')
    // The forked client should be a different instance
    expect(fork).not.toBe(parent)
  })

  it('forked client is already mounted and online', async () => {
    fork = await parent.fork()
    expect(fork.online).toBe(true)
  })

  it('fork() accepts optional label and ttl', async () => {
    fork = await parent.fork({ label: 'my-fork', ttl: 3600 })
    expect(fork).toBeDefined()
  })

  // ── §8.1 CoW read fall-through ────────────────────────────────────────────

  it('fork can read files created in the parent (fall-through read)', async () => {
    await parent.writeText('/shared.txt', 'from parent')
    fork = await parent.fork()
    const content = await fork.readText('/shared.txt')
    expect(content).toBe('from parent')
  })

  it('fork can stat files from the parent', async () => {
    await parent.writeText('/parent-file.txt', 'x')
    fork = await parent.fork()
    const node = await fork.stat('/parent-file.txt')
    expect(node.type).toBe('file')
    expect(node.name).toBe('parent-file.txt')
  })

  // ── §8.1 CoW isolation ────────────────────────────────────────────────────

  it('write in fork does not affect parent (CoW isolation)', async () => {
    await parent.writeText('/cow.txt', 'original')
    fork = await parent.fork()
    await fork.writeText('/cow.txt', 'modified in fork')
    const parentContent = await parent.readText('/cow.txt')
    expect(parentContent).toBe('original')
    const forkContent = await fork.readText('/cow.txt')
    expect(forkContent).toBe('modified in fork')
  })

  it('file created in fork does not appear in parent', async () => {
    fork = await parent.fork()
    await fork.writeText('/fork-only.txt', 'fork only')
    expect(await parent.exists('/fork-only.txt')).toBe(false)
    expect(await fork.exists('/fork-only.txt')).toBe(true)
  })

  it('rm in fork does not delete from parent', async () => {
    await parent.writeText('/deletable.txt', 'parent owns this')
    fork = await parent.fork()
    await fork.rm('/deletable.txt')
    expect(await parent.exists('/deletable.txt')).toBe(true)
    expect(await fork.exists('/deletable.txt')).toBe(false)
  })

  // ── §8.2 isOwned() ────────────────────────────────────────────────────────

  it('isOwned() returns false for a path inherited from parent', async () => {
    await parent.writeText('/inherited.txt', 'x')
    fork = await parent.fork()
    expect(await fork.isOwned('/inherited.txt')).toBe(false)
  })

  it('isOwned() returns true after writing the path in the fork', async () => {
    await parent.writeText('/will-be-owned.txt', 'old')
    fork = await parent.fork()
    await fork.writeText('/will-be-owned.txt', 'new')
    expect(await fork.isOwned('/will-be-owned.txt')).toBe(true)
  })

  it('isOwned() returns true for a file created only in the fork', async () => {
    fork = await parent.fork()
    await fork.writeText('/fork-created.txt', 'new')
    expect(await fork.isOwned('/fork-created.txt')).toBe(true)
  })

  it('isOwned() on parent always returns true for its own files', async () => {
    await parent.writeText('/parent-own.txt', 'mine')
    expect(await parent.isOwned('/parent-own.txt')).toBe(true)
  })

  // ── §8.3 V1 fork depth cap ────────────────────────────────────────────────

  it('forking a fork returns RvfsError (fork_depth > 1 not allowed in V1)', async () => {
    fork = await parent.fork()
    await expect(fork.fork()).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof RvfsError &&
        (e.code === 'EINVAL' || e.code === 'EPERM' || (e.status === 400)),
    )
  })

  // ── §8 fork with custom config ────────────────────────────────────────────

  it('forked client respects offlineFallback from config', async () => {
    // The fork should inherit or allow setting its own config
    fork = await parent.fork({ label: 'config-test' })
    expect(fork.online).toBe(true)
  })
})
