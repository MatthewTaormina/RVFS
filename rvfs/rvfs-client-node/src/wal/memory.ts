import { randomUUID } from 'node:crypto'
import type { PendingWrite } from 'rvfs-types'
import { RvfsError } from 'rvfs-types'

type AppendInput = {
  fsid: string
  op: PendingWrite['op']
  path: string
  args: Record<string, unknown>
}

type ListFilter = {
  status?: PendingWrite['status']
  fsid?: string
}

export class MemoryWal {
  private entries = new Map<string, PendingWrite>()
  private order: string[] = []

  get size(): number { return this.entries.size }

  async append(input: AppendInput): Promise<PendingWrite> {
    const entry: PendingWrite = {
      id: randomUUID(),
      fsid: input.fsid,
      op: input.op,
      path: input.path,
      args: input.args,
      queued_at: new Date(),
      status: 'pending',
      retry: 0,
      error: null,
    }
    this.entries.set(entry.id, entry)
    this.order.push(entry.id)
    return { ...entry }
  }

  async get(id: string): Promise<PendingWrite | undefined> {
    const e = this.entries.get(id)
    return e ? { ...e } : undefined
  }

  async list(filter?: ListFilter): Promise<PendingWrite[]> {
    const result: PendingWrite[] = []
    for (const id of this.order) {
      const e = this.entries.get(id)
      if (!e) continue
      if (filter?.status !== undefined && e.status !== filter.status) continue
      if (filter?.fsid !== undefined && e.fsid !== filter.fsid) continue
      result.push({ ...e })
    }
    return result
  }

  async setStatus(
    id: string,
    status: PendingWrite['status'],
    errorMsg?: string,
  ): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) throw new RvfsError('ENOENT', `WAL entry not found: ${id}`)
    entry.status = status
    if (status === 'error') {
      entry.error = errorMsg ?? null
      entry.retry++
    } else {
      entry.error = null
    }
  }

  async discard(id: string): Promise<void> {
    if (!this.entries.has(id)) throw new RvfsError('ENOENT', `WAL entry not found: ${id}`)
    this.entries.delete(id)
    this.order = this.order.filter(x => x !== id)
  }

  async clearCompleted(): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.status === 'done') {
        this.entries.delete(id)
      }
    }
    this.order = this.order.filter(id => this.entries.has(id))
  }
}

