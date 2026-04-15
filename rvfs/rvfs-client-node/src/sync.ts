import type { SyncResult, PendingWrite } from 'rvfs-types'
import { RvfsError } from 'rvfs-types'
import type { RvfsHttp } from './http.js'
import type { MemoryWal } from './wal/memory.js'

export type SyncErrorHandler = (entry: PendingWrite, error: RvfsError) => void

export async function syncWal(
  http: RvfsHttp,
  wal: MemoryWal,
  fsid: string,
  conflictPolicy: 'overwrite' | 'fail',
  onSyncError?: SyncErrorHandler,
): Promise<SyncResult> {
  const pending = await wal.list({ status: 'pending' })
  let applied = 0, conflicts = 0, errors = 0

  for (const entry of pending) {
    await wal.setStatus(entry.id, 'syncing')
    try {
      await replayEntry(http, fsid, entry)
      await wal.setStatus(entry.id, 'done')
      applied++
    } catch (err) {
      const e = err instanceof RvfsError ? err : new RvfsError('EIO', String(err))
      if (e.status === 409) {
        if (conflictPolicy === 'overwrite') {
          try {
            await replayEntry(http, fsid, entry, true)
            await wal.setStatus(entry.id, 'done')
            applied++
          } catch (e2) {
            await wal.setStatus(entry.id, 'error', String(e2))
            errors++
          }
        } else {
          await wal.setStatus(entry.id, 'conflict')
          conflicts++
        }
      } else {
        await wal.setStatus(entry.id, 'error', e.message)
        errors++
        onSyncError?.(entry, e)
      }
    }
  }

  const done = await wal.list({ status: 'done' })
  const skipped = done.length

  return { applied, conflicts, errors, skipped }
}

async function replayEntry(
  http: RvfsHttp,
  fsid: string,
  entry: PendingWrite,
  force = false,
): Promise<void> {
  const base = `/fs/${fsid}/op`
  switch (entry.op) {
    case 'write':
      await http.post(`${base}/write`, {
        path: entry.path,
        ...entry.args,
        ...(force ? { no_clobber: false } : {}),
      })
      break
    case 'create':
    case 'mkdir':
      await http.post(`${base}/create`, {
        path: entry.path,
        type: entry.op === 'mkdir' ? 'dir' : (entry.args.type ?? 'file'),
        ...entry.args,
      })
      break
    case 'rm':
    case 'rmdir':
      await http.post(`${base}/rm`, { path: entry.path, ...entry.args })
      break
    case 'mv':
      await http.post(`${base}/mv`, { path: entry.path, ...entry.args })
      break
    case 'cp':
      await http.post(`${base}/write`, {
        path: entry.args.dst as string,
        content: entry.args.content,
      })
      break
    case 'chmod':
    case 'chown':
      // Meta ops — skip in WAL replay (server nid may have changed)
      break
  }
}

