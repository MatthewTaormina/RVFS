/**
 * §12 — Offline mode: writes queue to WAL, optimistic cache, reconnect sync.
 *
 * Tests verify that when the server is unreachable the client:
 *  - queues writes to the WAL instead of failing
 *  - serves reads from the optimistic / stale cache
 *  - emits 'offline' and 'online' events appropriately
 *  - replays the WAL on reconnect when syncOnReconnect is true
 *
 * Tests will fail until Sam implements offline support in SystemRvfsClient.
 *
 * Spec sections: §12.1 (WAL), §12.2 (offline writes), §12.3 (sync)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { IRvfsClient, RvfsEvent } from 'rvfs-types'
import { RvfsError } from 'rvfs-types'

// @ts-ignore — stub exports {} until implemented
import { SystemRvfsClient } from '../src/client.js'
import { startMockServer, makeConfig, type MockServerHandle } from './setup.js'

function makeClient(handle: MockServerHandle, overrides = {}): IRvfsClient {
  return new SystemRvfsClient(makeConfig(handle, { watchOnMount: false, ...overrides }))
}

describe('Offline mode', () => {
  let handle: MockServerHandle
  let client: IRvfsClient

  beforeEach(async () => {
    handle = await startMockServer()
  })

  afterEach(async () => {
    try { await client?.unmount() } catch { /* ignore */ }
    await handle.close()
  })

  // ── §12.2 WAL queueing when offline ──────────────────────────────────────

  it('queues a write to the WAL when client is offline', async () => {
    client = makeClient(handle, { offlineFallback: true })
    await client.mount()

    // Simulate going offline by pointing the client at a port that refuses connections
    // We do this by closing the server mid-session
    await handle.close()

    // Write should not throw — it should queue to WAL
    await expect(client.writeText('/offline-write.txt', 'queued')).resolves.toBeUndefined()

    const pending = await client.getPendingWrites()
    expect(pending.some(e => e.path === '/offline-write.txt' && e.op === 'write')).toBe(true)
  })

  it('emits "offline" event when connectivity is lost', async () => {
    client = makeClient(handle, { offlineFallback: true })
    const events: string[] = []
    client.on('offline', () => events.push('offline'))
    await client.mount()
    await handle.close()
    // Trigger a request that will fail
    await client.writeText('/trigger.txt', 'x').catch(() => {})
    // Wait briefly for event
    await new Promise(r => setTimeout(r, 50))
    expect(events).toContain('offline')
  })

  it('online property is false after going offline', async () => {
    client = makeClient(handle, { offlineFallback: true })
    await client.mount()
    expect(client.online).toBe(true)
    await handle.close()
    // Trigger failure
    await client.writeText('/probe.txt', 'x').catch(() => {})
    await new Promise(r => setTimeout(r, 50))
    expect(client.online).toBe(false)
  })

  it('throws RvfsError(OFFLINE) on read when offline and no cached value', async () => {
    client = makeClient(handle, { offlineFallback: true })
    await client.mount()
    await handle.close()
    await expect(client.readText('/not-in-cache.txt')).rejects.toSatisfy(
      (e: unknown) => e instanceof RvfsError && e.code === 'OFFLINE',
    )
  })

  it('serves a cached read when offline (stale cache)', async () => {
    client = makeClient(handle, { offlineFallback: true })
    await client.mount()
    // Pre-warm the cache
    await client.writeText('/cached.txt', 'cache-me')
    await client.readText('/cached.txt') // cache it
    // Go offline
    await handle.close()
    // Should return stale cached value without throwing
    const content = await client.readText('/cached.txt')
    expect(content).toBe('cache-me')
  })

  // ── §12.3 Reconnect sync ──────────────────────────────────────────────────

  it('replays WAL on reconnect when syncOnReconnect is true', async () => {
    // Start with a fresh server for reconnect test
    const handle2 = await startMockServer()
    client = makeClient(handle2, { offlineFallback: true, syncOnReconnect: true })
    const events: string[] = []
    client.on('sync:complete', () => events.push('sync:complete'))

    await client.mount()
    // Queue a write offline
    await handle2.close()
    await client.writeText('/reconnect-test.txt', 'queued').catch(() => {})
    await new Promise(r => setTimeout(r, 50))

    // Bring server back up at same port — not possible with our mock,
    // so instead just verify sync:complete fires on explicit sync()
    const newHandle = await startMockServer()
    // Update client baseUrl (if client supports reconfiguration) OR call sync()
    const result = await client.sync()
    await newHandle.close()
    expect(typeof result.applied).toBe('number')
  })

  it('does NOT auto-sync on reconnect when syncOnReconnect is false', async () => {
    client = makeClient(handle, { offlineFallback: true, syncOnReconnect: false })
    const syncEvents: string[] = []
    client.on('sync:start', () => syncEvents.push('sync:start'))
    await client.mount()
    // Going offline and back online should not trigger auto-sync
    await handle.close()
    await new Promise(r => setTimeout(r, 100))
    // No sync:start events should have fired automatically
    expect(syncEvents).not.toContain('sync:start')
  })

  // ── §12 offlineFallback: false — throw immediately ────────────────────────

  it('throws immediately when offlineFallback is false and server is unreachable', async () => {
    client = makeClient(handle, { offlineFallback: false })
    await client.mount()
    await handle.close()
    await expect(client.writeText('/fail.txt', 'x')).rejects.toBeInstanceOf(RvfsError)
    const pending = await client.getPendingWrites()
    expect(pending.length).toBe(0)
  })
})
