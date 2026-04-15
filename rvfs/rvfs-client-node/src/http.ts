import { RvfsError, type RvfsErrorCode } from 'rvfs-types'

const ERROR_CODE_MAP: Record<string, RvfsErrorCode> = {
  ENOENT: 'ENOENT', EEXIST: 'EEXIST', EINVAL: 'EINVAL', EISDIR: 'EISDIR',
  ENOTDIR: 'ENOTDIR', ENOTEMPTY: 'ENOTEMPTY', EPERM: 'EPERM', EACCES: 'EACCES',
  FORBIDDEN: 'FORBIDDEN', CONFLICT: 'CONFLICT', OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT', FORK_DEPTH_EXCEEDED: 'EINVAL', SESSION_EXPIRED: 'FORBIDDEN',
}

function statusToCode(status: number, bodyCode?: string): RvfsErrorCode {
  if (bodyCode && ERROR_CODE_MAP[bodyCode]) return ERROR_CODE_MAP[bodyCode]
  switch (status) {
    case 400: return 'EINVAL'
    case 401: return 'FORBIDDEN'
    case 403: return 'FORBIDDEN'
    case 404: return 'ENOENT'
    case 409: return 'EEXIST'
    case 429: return 'TIMEOUT'
    default:  return 'EIO'
  }
}

export function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (err.message.includes('fetch failed') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('network') ||
      err.message.includes('socket'))
  )
}

export class RvfsHttp {
  constructor(
    private readonly baseUrl: string,
    private sessionId: string,
  ) {}

  updateSession(sessionId: string): void { this.sessionId = sessionId }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.sessionId}`,
      'Content-Type': 'application/json',
    }
  }

  private async handleResponse<T>(res: Response, path: string): Promise<T> {
    if (res.status === 204) return undefined as unknown as T
    if (!res.ok) {
      let body: Record<string, unknown> = {}
      try { body = await res.json() as Record<string, unknown> } catch { /* ignore */ }
      const code = statusToCode(res.status, body.error as string | undefined)
      throw new RvfsError(code, (body.message as string | undefined) ?? `HTTP ${res.status}`, {
        path,
        status: res.status,
      })
    }
    return res.json() as Promise<T>
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.authHeaders() })
    return this.handleResponse<T>(res, path)
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    })
    return this.handleResponse<T>(res, path)
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    })
    return this.handleResponse<T>(res, path)
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    })
    if (!res.ok) {
      let body: Record<string, unknown> = {}
      try { body = await res.json() as Record<string, unknown> } catch { /* ignore */ }
      const code = statusToCode(res.status, body.error as string | undefined)
      throw new RvfsError(code, (body.message as string | undefined) ?? `HTTP ${res.status}`, {
        path, status: res.status,
      })
    }
  }

  async getStream(path: string, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { ...this.authHeaders(), Accept: 'text/event-stream' },
      signal,
    })
  }
}

