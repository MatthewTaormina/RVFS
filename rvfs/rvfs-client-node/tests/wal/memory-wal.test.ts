/**
 * §12.1 — In-memory WAL (Write-Ahead Log).
 *
 * Tests append, status transitions, retry tracking, ordering guarantees,
 * and discard. These tests will fail until Sam implements MemoryWal in
 * src/wal/memory.ts.
 *
 * Spec sections: §12.1 (WAL entries), §12.2 (status lifecycle)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { PendingWrite } from 'rvfs-types'

// @ts-ignore — stub exports {} until implemented
import { MemoryWal } from '../../src/wal/memory.js'

describe('MemoryWal', () => {
  let wal: InstanceType<typeof MemoryWal>

  beforeEach(() => {
    wal = new MemoryWal()
  })

  // ── §12.1 Append ──────────────────────────────────────────────────────────

  it('append() returns a PendingWrite with status "pending"', async () => {
    const entry = await wal.append({
      fsid: 'fs-001',
      op: 'write',
      path: '/hello.txt',
      args: { content: 'hi' },
    })
    expect(entry.status).toBe('pending')
    expect(typeof entry.id).toBe('string')
    expect(entry.fsid).toBe('fs-001')
    expect(entry.op).toBe('write')
    expect(entry.path).toBe('/hello.txt')
    expect(entry.retry).toBe(0)
    expect(entry.error).toBeNull()
    expect(entry.queued_at).toBeInstanceOf(Date)
  })

  it('appended entry appears in list()', async () => {
    await wal.append({ fsid: 'fs-001', op: 'create', path: '/new.txt', args: {} })
    const all = await wal.list()
    expect(all.length).toBeGreaterThan(0)
    expect(all.some(e => e.path === '/new.txt')).toBe(true)
  })

  it('generates unique ids for each entry', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/a.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-001', op: 'write', path: '/b.txt', args: {} })
    expect(a.id).not.toBe(b.id)
  })

  it('entries are returned in FIFO order', async () => {
    await wal.append({ fsid: 'fs-001', op: 'create', path: '/first.txt', args: {} })
    await wal.append({ fsid: 'fs-001', op: 'create', path: '/second.txt', args: {} })
    await wal.append({ fsid: 'fs-001', op: 'create', path: '/third.txt', args: {} })
    const all = await wal.list()
    const paths = all.map(e => e.path)
    const firstIdx = paths.indexOf('/first.txt')
    const secondIdx = paths.indexOf('/second.txt')
    const thirdIdx = paths.indexOf('/third.txt')
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  // ── §12.2 Status transitions ──────────────────────────────────────────────

  it('setStatus() transitions pending → syncing', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/x.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    const updated = await wal.get(entry.id)
    expect(updated?.status).toBe('syncing')
  })

  it('setStatus() transitions syncing → done', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/y.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'done')
    const updated = await wal.get(entry.id)
    expect(updated?.status).toBe('done')
  })

  it('setStatus() transitions syncing → conflict', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/z.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'conflict')
    const updated = await wal.get(entry.id)
    expect(updated?.status).toBe('conflict')
  })

  it('setStatus() transitions syncing → error and records error message', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/err.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'error', 'network timeout')
    const updated = await wal.get(entry.id)
    expect(updated?.status).toBe('error')
    expect(updated?.error).toBe('network timeout')
  })

  it('setStatus() increments retry on error', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/retry.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'error', 'fail 1')
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'error', 'fail 2')
    const updated = await wal.get(entry.id)
    expect(updated?.retry).toBe(2)
  })

  it('setStatus() throws for an unknown entry id', async () => {
    await expect(wal.setStatus('bad-id', 'done')).rejects.toThrow()
  })

  it('setStatus() clears error field when transitioning away from error', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/clear-err.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'error', 'some failure')
    await wal.setStatus(entry.id, 'syncing')
    const updated = await wal.get(entry.id)
    expect(updated?.error).toBeNull()
  })

  it('retry is NOT incremented when re-queuing error → pending', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'write', path: '/requeue.txt', args: {} })
    await wal.setStatus(entry.id, 'syncing')
    await wal.setStatus(entry.id, 'error', 'first failure')
    const afterError = await wal.get(entry.id)
    expect(afterError?.retry).toBe(1)
    await wal.setStatus(entry.id, 'pending')
    const afterRequeue = await wal.get(entry.id)
    expect(afterRequeue?.retry).toBe(1)
  })

  // ── §12.2 Filter by status ────────────────────────────────────────────────

  it('list({ status: "pending" }) returns only pending entries', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/pending.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-001', op: 'write', path: '/done.txt', args: {} })
    await wal.setStatus(b.id, 'syncing')
    await wal.setStatus(b.id, 'done')
    const pending = await wal.list({ status: 'pending' })
    expect(pending.every(e => e.status === 'pending')).toBe(true)
    expect(pending.some(e => e.id === a.id)).toBe(true)
    expect(pending.some(e => e.id === b.id)).toBe(false)
  })

  it('list({ fsid }) returns only entries for that fsid', async () => {
    await wal.append({ fsid: 'fs-A', op: 'write', path: '/a.txt', args: {} })
    await wal.append({ fsid: 'fs-B', op: 'write', path: '/b.txt', args: {} })
    const fsA = await wal.list({ fsid: 'fs-A' })
    expect(fsA.every(e => e.fsid === 'fs-A')).toBe(true)
  })

  it('list({ status: "conflict" }) returns only conflict entries', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/conflict.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-001', op: 'write', path: '/pending.txt', args: {} })
    await wal.setStatus(a.id, 'syncing')
    await wal.setStatus(a.id, 'conflict')
    const conflicts = await wal.list({ status: 'conflict' })
    expect(conflicts.every(e => e.status === 'conflict')).toBe(true)
    expect(conflicts.some(e => e.id === a.id)).toBe(true)
    expect(conflicts.some(e => e.id === b.id)).toBe(false)
  })

  it('list({ status: "error" }) returns only error entries', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/error.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-001', op: 'write', path: '/pending2.txt', args: {} })
    await wal.setStatus(a.id, 'syncing')
    await wal.setStatus(a.id, 'error', 'kaboom')
    const errors = await wal.list({ status: 'error' })
    expect(errors.every(e => e.status === 'error')).toBe(true)
    expect(errors.some(e => e.id === a.id)).toBe(true)
    expect(errors.some(e => e.id === b.id)).toBe(false)
  })

  it('list({ fsid, status }) combines both filters', async () => {
    const a = await wal.append({ fsid: 'fs-A', op: 'write', path: '/a-pending.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-A', op: 'write', path: '/a-done.txt', args: {} })
    const c = await wal.append({ fsid: 'fs-B', op: 'write', path: '/b-pending.txt', args: {} })
    await wal.setStatus(b.id, 'syncing')
    await wal.setStatus(b.id, 'done')
    const result = await wal.list({ fsid: 'fs-A', status: 'pending' })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe(a.id)
    expect(result.some(e => e.id === b.id)).toBe(false)
    expect(result.some(e => e.id === c.id)).toBe(false)
  })

  // ── §12.1 Discard ─────────────────────────────────────────────────────────

  it('discard() removes the entry', async () => {
    const entry = await wal.append({ fsid: 'fs-001', op: 'rm', path: '/discard.txt', args: {} })
    await wal.discard(entry.id)
    expect(await wal.get(entry.id)).toBeUndefined()
  })

  it('discard() throws for an unknown entry id', async () => {
    await expect(wal.discard('unknown')).rejects.toThrow()
  })

  // ── §12.1 Clear completed ─────────────────────────────────────────────────

  it('clearCompleted() removes all done entries', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/done1.txt', args: {} })
    const b = await wal.append({ fsid: 'fs-001', op: 'write', path: '/pending1.txt', args: {} })
    await wal.setStatus(a.id, 'syncing')
    await wal.setStatus(a.id, 'done')
    await wal.clearCompleted()
    expect(await wal.get(a.id)).toBeUndefined()
    expect(await wal.get(b.id)).toBeDefined()
  })

  it('clearCompleted() does NOT remove conflict or error entries', async () => {
    const done = await wal.append({ fsid: 'fs-001', op: 'write', path: '/done.txt', args: {} })
    const conflict = await wal.append({ fsid: 'fs-001', op: 'write', path: '/conflict.txt', args: {} })
    const error = await wal.append({ fsid: 'fs-001', op: 'write', path: '/error.txt', args: {} })
    await wal.setStatus(done.id, 'syncing')
    await wal.setStatus(done.id, 'done')
    await wal.setStatus(conflict.id, 'syncing')
    await wal.setStatus(conflict.id, 'conflict')
    await wal.setStatus(error.id, 'syncing')
    await wal.setStatus(error.id, 'error', 'boom')
    await wal.clearCompleted()
    expect(await wal.get(done.id)).toBeUndefined()
    expect(await wal.get(conflict.id)).toBeDefined()
    expect(await wal.get(error.id)).toBeDefined()
  })

  // ── §12.1 Size ────────────────────────────────────────────────────────────

  it('size reflects total number of entries', async () => {
    expect(wal.size).toBe(0)
    await wal.append({ fsid: 'fs-001', op: 'write', path: '/a.txt', args: {} })
    expect(wal.size).toBe(1)
    await wal.append({ fsid: 'fs-001', op: 'write', path: '/b.txt', args: {} })
    expect(wal.size).toBe(2)
  })

  it('size decrements after discard()', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/a.txt', args: {} })
    await wal.append({ fsid: 'fs-001', op: 'write', path: '/b.txt', args: {} })
    expect(wal.size).toBe(2)
    await wal.discard(a.id)
    expect(wal.size).toBe(1)
  })

  it('size decrements after clearCompleted()', async () => {
    const a = await wal.append({ fsid: 'fs-001', op: 'write', path: '/a.txt', args: {} })
    await wal.setStatus(a.id, 'syncing')
    await wal.setStatus(a.id, 'done')
    expect(wal.size).toBe(1)
    await wal.clearCompleted()
    expect(wal.size).toBe(0)
  })
})
