import type { RvfsChangeEvent } from 'rvfs-types'
import type { RvfsHttp } from './http.js'

export type SseHandler = (event: RvfsChangeEvent) => void

export class SseClient {
  private abortController: AbortController | null = null
  private handlers = new Set<SseHandler>()
  private pathHandlers: Array<{ pattern: string; handler: SseHandler }> = []
  private lastEventId: string | null = null
  private onReset?: () => void
  private onEvent?: (event: RvfsChangeEvent) => void

  constructor(
    private readonly http: RvfsHttp,
    private readonly fsid: string,
  ) {}

  setOnReset(fn: () => void): void { this.onReset = fn }
  setOnEvent(fn: (event: RvfsChangeEvent) => void): void { this.onEvent = fn }

  addHandler(handler: SseHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  addPathHandler(pattern: string, handler: SseHandler): () => void {
    const entry = { pattern, handler }
    this.pathHandlers.push(entry)
    return () => {
      const idx = this.pathHandlers.indexOf(entry)
      if (idx !== -1) this.pathHandlers.splice(idx, 1)
    }
  }

  dispatch(event: RvfsChangeEvent): void {
    this.onEvent?.(event)
    for (const h of this.handlers) h(event)
    for (const { pattern, handler } of this.pathHandlers) {
      if (this.matchGlob(event.path ?? '', pattern)) handler(event)
    }
  }

  private matchGlob(path: string, pattern: string): boolean {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\x00')
      .replace(/\*/g, '[^/]*')
      .replace(/\x00/g, '.*')
    return new RegExp(`^${escaped}$`).test(path)
  }

  async connect(): Promise<void> {
    this.abortController = new AbortController()
    const params = this.lastEventId ? `?since=${encodeURIComponent(this.lastEventId)}` : ''
    const res = await this.http.getStream(
      `/fs/${this.fsid}/watch${params}`,
      this.abortController.signal,
    )
    if (!res.ok || !res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    const readLoop = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const blocks = buf.split(/\n\n/)
          buf = blocks.pop() ?? ''
          for (const block of blocks) {
            if (!block.trim()) continue
            const parsed = this.parseBlock(block)
            if (!parsed) continue
            if (parsed.event === 'stream:reset') {
              this.onReset?.()
            } else {
              this.dispatch(parsed)
            }
            if (parsed.event_id) this.lastEventId = parsed.event_id
          }
        }
      } catch { /* aborted or connection closed */ }
    }

    readLoop().catch(() => {})
  }

  private parseBlock(block: string): RvfsChangeEvent | null {
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data = line.slice(5).trim()
    }
    if (!data) return null
    try { return JSON.parse(data) as RvfsChangeEvent } catch { return null }
  }

  close(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}

