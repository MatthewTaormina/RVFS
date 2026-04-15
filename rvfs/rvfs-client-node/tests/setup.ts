/**
 * Shared test helpers for rvfs-client-node tests.
 *
 * Uses a hand-rolled Node.js HTTP mock server so that tests fail exclusively
 * because SystemRvfsClient has not been implemented yet — not because of a
 * missing server dependency.
 *
 * When both the server and client are implemented, replace the mock server
 * with a real rvfs-server-node instance started with app.listen().
 */

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { RvfsClientConfig } from 'rvfs-types'

// ── State ──────────────────────────────────────────────────────────────────

interface FsRecord {
  fsid: string
  root_nid: string
  label: string
  created_at: string
  updated_at: string
  ttl: number | null
  fork_of: string | null
  fork_depth: number
}

interface SessionRecord {
  session_id: string
  identity: string
  created_at: string
  expires_at: string
  ttl_seconds: number
  filesystems: Array<{ fsid: string; access: string }>
  metadata: Record<string, unknown>
}

interface NodeRecord {
  nid: string
  type: 'file' | 'dir'
  name: string
  parent_nid: string | null
  fsid: string
  created_at: string
  updated_at: string
  ttl: number | null
  meta: {
    mode: number; uid: number; gid: number
    atime: string; mtime: string; ctime: string
    nlink: number; inode: number
  }
  children?: string[]
  name_index?: Record<string, string>
  blob_nid?: string | null
  size?: number
  symlink_target?: string | null
  content?: string
}

// ── Mock server factory ────────────────────────────────────────────────────

export interface MockServerHandle {
  baseUrl: string
  sessionId: string
  fsid: string
  rootNid: string
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/**
 * Start a minimal RVFS mock HTTP server on an ephemeral port.
 * Returns the baseUrl, a pre-created sessionId and fsid for use in tests.
 */
export function startMockServer(): Promise<MockServerHandle> {
  const sessions = new Map<string, SessionRecord>()
  const filesystems = new Map<string, FsRecord>()
  const nodes = new Map<string, NodeRecord>()
  const blobs = new Map<string, { content: Buffer; sha256: string; size: number; mime: string }>()

  // Pre-seed a session and filesystem
  const sessionId = randomUUID()
  const fsid = `fs-${randomUUID()}`
  const rootNid = `n-${randomUUID()}`
  const now = new Date().toISOString()

  sessions.set(sessionId, {
    session_id: sessionId,
    identity: 'test-user',
    created_at: now,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ttl_seconds: 3600,
    filesystems: [{ fsid, access: 'admin' }],
    metadata: {},
  })

  filesystems.set(fsid, {
    fsid,
    root_nid: rootNid,
    label: 'test-fs',
    created_at: now,
    updated_at: now,
    ttl: null,
    fork_of: null,
    fork_depth: 0,
  })

  const makeMeta = (override: Partial<NodeRecord['meta']> = {}): NodeRecord['meta'] => ({
    mode: 0o755, uid: 1000, gid: 1000,
    atime: now, mtime: now, ctime: now,
    nlink: 1, inode: Math.floor(Math.random() * 2 ** 32),
    ...override,
  })

  nodes.set(rootNid, {
    nid: rootNid, type: 'dir', name: '', parent_nid: null,
    fsid, created_at: now, updated_at: now, ttl: null,
    meta: makeMeta(), children: [], name_index: {},
  })

  function getSession(req: IncomingMessage): SessionRecord | null {
    const auth = req.headers.authorization ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    return sessions.get(token) ?? null
  }

  function requireSession(req: IncomingMessage, res: ServerResponse): SessionRecord | null {
    const sess = getSession(req)
    if (!sess) { json(res, 401, { error: 'UNAUTHORIZED', message: 'Missing or invalid session token' }); return null }
    if (new Date(sess.expires_at) < new Date()) { json(res, 401, { error: 'SESSION_EXPIRED', message: 'Session has expired' }); return null }
    return sess
  }

  function resolveParentAndName(fsId: string, path: string): { parent: NodeRecord; name: string } | null {
    const fs = filesystems.get(fsId)
    if (!fs) return null
    const parts = path.replace(/^\//, '').split('/').filter(Boolean)
    if (parts.length === 0) return null
    const name = parts[parts.length - 1]
    if (parts.length === 1) {
      const root = nodes.get(fs.root_nid)
      if (!root) return null
      return { parent: root, name }
    }
    const parentPath = '/' + parts.slice(0, -1).join('/')
    const parent = resolveNode(fsId, parentPath)
    if (!parent) return null
    return { parent, name }
  }

  function resolveNode(fsId: string, path: string): NodeRecord | null {
    const parts = path.replace(/^\//, '').split('/').filter(Boolean)
    const fs = filesystems.get(fsId)
    if (!fs) return null
    const root = nodes.get(fs.root_nid)
    if (!root) return null
    if (parts.length === 0) return root
    let current: NodeRecord = root
    for (const part of parts) {
      const childNid = current.name_index?.[part]
      if (!childNid) return null
      const child = nodes.get(childNid)
      if (!child) return null
      current = child
    }
    return current
  }

  const server: Server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    const pathname = url.pathname
    const method = req.method ?? 'GET'

    // ── /ping ──────────────────────────────────────────────────────────────
    if (method === 'GET' && pathname === '/ping') {
      return json(res, 200, { ok: true })
    }

    // ── POST /session ──────────────────────────────────────────────────────
    if (method === 'POST' && pathname === '/session') {
      const body = await readBody(req) as Record<string, unknown>
      const ttl = Number(body.ttl_seconds ?? 3600)
      const sid = randomUUID()
      const nowStr = new Date().toISOString()
      const record: SessionRecord = {
        session_id: sid,
        identity: String(body.identity ?? 'guest'),
        created_at: nowStr,
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
        ttl_seconds: ttl,
        filesystems: (body.filesystems as SessionRecord['filesystems']) ?? [],
        metadata: (body.metadata as Record<string, unknown>) ?? {},
      }
      sessions.set(sid, record)
      return json(res, 201, record)
    }

    // ── GET /session/:id ───────────────────────────────────────────────────
    const sessionGet = pathname.match(/^\/session\/([^/]+)$/)
    if (method === 'GET' && sessionGet) {
      if (!requireSession(req, res)) return
      const sid = sessionGet[1]
      const sess = sessions.get(sid)
      if (!sess) return json(res, 404, { error: 'NOT_FOUND', message: 'Session not found' })
      return json(res, 200, sess)
    }

    // ── DELETE /session/:id ────────────────────────────────────────────────
    const sessionDelete = pathname.match(/^\/session\/([^/]+)$/)
    if (method === 'DELETE' && sessionDelete) {
      if (!requireSession(req, res)) return
      const sid = sessionDelete[1]
      if (!sessions.has(sid)) return json(res, 404, { error: 'NOT_FOUND', message: 'Session not found' })
      sessions.delete(sid)
      return json(res, 204, {})
    }

    // ── POST /fs ───────────────────────────────────────────────────────────
    if (method === 'POST' && pathname === '/fs') {
      const sess = requireSession(req, res)
      if (!sess) return
      const body = await readBody(req) as Record<string, unknown>
      const newFsid = `fs-${randomUUID()}`
      const newRootNid = `n-${randomUUID()}`
      const nowStr = new Date().toISOString()
      const fs: FsRecord = {
        fsid: newFsid, root_nid: newRootNid,
        label: String(body.label ?? 'untitled'),
        created_at: nowStr, updated_at: nowStr,
        ttl: (body.ttl as number | null) ?? null,
        fork_of: null, fork_depth: 0,
      }
      filesystems.set(newFsid, fs)
      nodes.set(newRootNid, {
        nid: newRootNid, type: 'dir', name: '', parent_nid: null,
        fsid: newFsid, created_at: nowStr, updated_at: nowStr, ttl: null,
        meta: makeMeta(), children: [], name_index: {},
      })
      sess.filesystems.push({ fsid: newFsid, access: 'admin' })
      return json(res, 201, fs)
    }

    // ── GET /fs/:fsid ──────────────────────────────────────────────────────
    const fsGet = pathname.match(/^\/fs\/([^/]+)$/)
    if (method === 'GET' && fsGet) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = fsGet[1]
      const fs = filesystems.get(fid)
      if (!fs) return json(res, 404, { error: 'NOT_FOUND', message: 'Filesystem not found' })
      return json(res, 200, fs)
    }

    // ── POST /fs/:fsid/fork ────────────────────────────────────────────────
    const fsFork = pathname.match(/^\/fs\/([^/]+)\/fork$/)
    if (method === 'POST' && fsFork) {
      const sess = requireSession(req, res)
      if (!sess) return
      const parentFsid = fsFork[1]
      const parent = filesystems.get(parentFsid)
      if (!parent) return json(res, 404, { error: 'NOT_FOUND', message: 'Filesystem not found' })
      if (parent.fork_depth >= 1) {
        return json(res, 400, { error: 'FORK_DEPTH_EXCEEDED', message: 'V1 caps fork_depth at 1' })
      }
      const body = await readBody(req) as Record<string, unknown>
      const newFsid = `fs-${randomUUID()}`
      const newRootNid = `n-${randomUUID()}`
      const nowStr = new Date().toISOString()
      const forked: FsRecord = {
        fsid: newFsid, root_nid: newRootNid,
        label: String(body.label ?? `${parent.label}-fork`),
        created_at: nowStr, updated_at: nowStr,
        ttl: (body.ttl as number | null) ?? parent.ttl,
        fork_of: parentFsid, fork_depth: parent.fork_depth + 1,
      }
      filesystems.set(newFsid, forked)
      nodes.set(newRootNid, {
        nid: newRootNid, type: 'dir', name: '', parent_nid: null,
        fsid: newFsid, created_at: nowStr, updated_at: nowStr, ttl: null,
        meta: makeMeta(), children: [], name_index: {},
      })
      sess.filesystems.push({ fsid: newFsid, access: 'admin' })
      return json(res, 201, forked)
    }

    // ── POST /fs/:fsid/op/create ───────────────────────────────────────────
    const opCreate = pathname.match(/^\/fs\/([^/]+)\/op\/create$/)
    if (method === 'POST' && opCreate) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = opCreate[1]
      if (!filesystems.get(fid)) return json(res, 404, { error: 'NOT_FOUND', message: 'Filesystem not found' })
      const body = await readBody(req) as Record<string, unknown>
      const path = String(body.path ?? '/')
      if (path.includes('..')) return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      const nodeType = String(body.type ?? 'file')
      const resolved = resolveParentAndName(fid, path)
      if (!resolved) return json(res, 404, { error: 'ENOENT', message: 'Parent directory not found' })
      const { parent, name } = resolved
      if ((parent.name_index ?? {})[name]) return json(res, 409, { error: 'EEXIST', message: 'Node already exists' })
      const nowStr = new Date().toISOString()
      const nid = `n-${randomUUID()}`
      const metaOverride = (body.meta as Record<string, unknown> | undefined) ?? {}
      const mode = nodeType === 'dir' ? (metaOverride.mode as number ?? 0o755) : (metaOverride.mode as number ?? 0o644)
      const isSymlink = nodeType === 'symlink'
      const newNode: NodeRecord = {
        nid, type: isSymlink ? 'file' : nodeType as 'file' | 'dir', name,
        parent_nid: parent.nid, fsid: fid,
        created_at: nowStr, updated_at: nowStr,
        ttl: (body.ttl as number | null) ?? null,
        meta: makeMeta({ mode }),
        children: nodeType === 'dir' ? [] : undefined,
        name_index: nodeType === 'dir' ? {} : undefined,
        blob_nid: null, size: 0,
        symlink_target: isSymlink ? String(body.symlink_target ?? '') : null,
      }
      nodes.set(nid, newNode)
      parent.children = [...(parent.children ?? []), nid]
      parent.name_index = { ...(parent.name_index ?? {}), [name]: nid }
      return json(res, 201, { nid, path })
    }

    // ── POST /fs/:fsid/op/read ─────────────────────────────────────────────
    const opRead = pathname.match(/^\/fs\/([^/]+)\/op\/read$/)
    if (method === 'POST' && opRead) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = opRead[1]
      const body = await readBody(req) as Record<string, unknown>
      const path = String(body.path ?? '/')
      if (path.includes('..')) {
        return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      }
      const node = resolveNode(fid, path)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'No such file or directory' })
      if (node.type !== 'file') return json(res, 400, { error: 'EISDIR', message: 'Is a directory' })
      const content = node.content ?? ''
      return json(res, 200, { content, encoding: 'utf8', size: Buffer.byteLength(content) })
    }

    // ── POST /fs/:fsid/op/write ────────────────────────────────────────────
    const opWrite = pathname.match(/^\/fs\/([^/]+)\/op\/write$/)
    if (method === 'POST' && opWrite) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = opWrite[1]
      const body = await readBody(req) as Record<string, unknown>
      const path = String(body.path ?? '/')
      if (path.includes('..')) return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      let node = resolveNode(fid, path)
      const nowStr = new Date().toISOString()
      // noClobber check
      if (node && body.no_clobber) return json(res, 409, { error: 'EEXIST', message: 'File already exists (no_clobber)' })
      if (!node) {
        const resolved = resolveParentAndName(fid, path)
        if (!resolved) return json(res, 404, { error: 'ENOENT', message: 'Parent directory not found' })
        const { parent, name } = resolved
        const mode = (body.mode as number | undefined) ?? 0o644
        const nid = `n-${randomUUID()}`
        node = {
          nid, type: 'file', name, parent_nid: parent.nid,
          fsid: fid, created_at: nowStr, updated_at: nowStr, ttl: null,
          meta: makeMeta({ mode }),
          blob_nid: null, size: 0, symlink_target: null,
        }
        nodes.set(nid, node)
        parent.children = [...(parent.children ?? []), nid]
        parent.name_index = { ...(parent.name_index ?? {}), [name]: nid }
      }
      const content = String(body.content ?? '')
      node.content = content
      node.size = Buffer.byteLength(content)
      node.updated_at = nowStr
      if (body.mode !== undefined) node.meta = { ...node.meta, mode: body.mode as number }
      return json(res, 200, { nid: node.nid, path, size: node.size })
    }

    // ── POST /fs/:fsid/op/rm ───────────────────────────────────────────────
    const opRm = pathname.match(/^\/fs\/([^/]+)\/op\/rm$/)
    if (method === 'POST' && opRm) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = opRm[1]
      const body = await readBody(req) as Record<string, unknown>
      const path = String(body.path ?? '/')
      if (path.includes('..')) return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      const node = resolveNode(fid, path)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'No such file or directory' })
      // ENOTEMPTY check
      if (node.type === 'dir' && (node.children ?? []).length > 0) {
        return json(res, 400, { error: 'ENOTEMPTY', message: 'Directory not empty' })
      }
      nodes.delete(node.nid)
      const resolved = resolveParentAndName(fid, path)
      if (resolved) {
        const { parent, name } = resolved
        parent.children = (parent.children ?? []).filter(nid => nid !== node.nid)
        const { [name]: _, ...rest } = parent.name_index ?? {}
        parent.name_index = rest
      }
      return json(res, 200, { deleted: path })
    }

    // ── POST /fs/:fsid/op/mv ───────────────────────────────────────────────
    const opMv = pathname.match(/^\/fs\/([^/]+)\/op\/mv$/)
    if (method === 'POST' && opMv) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = opMv[1]
      const body = await readBody(req) as Record<string, unknown>
      const src = String(body.src ?? '')
      const dst = String(body.dst ?? '')
      if (src.includes('..') || dst.includes('..')) {
        return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      }
      const node = resolveNode(fid, src)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'No such file or directory' })
      const dstParts = dst.replace(/^\//, '').split('/').filter(Boolean)
      const newName = dstParts[dstParts.length - 1] ?? node.name
      const fs = filesystems.get(fid)!
      const root = nodes.get(fs.root_nid)!
      // remove old reference
      root.children = (root.children ?? []).filter(nid => nid !== node.nid)
      const { [node.name]: _, ...rest } = root.name_index ?? {}
      root.name_index = rest
      // add new reference
      node.name = newName
      root.children = [...(root.children ?? []), node.nid]
      root.name_index = { ...root.name_index, [newName]: node.nid }
      return json(res, 200, { nid: node.nid, src, dst })
    }

    // ── GET /fs/:fsid/node/:nid ────────────────────────────────────────────
    const nodeGet = pathname.match(/^\/fs\/([^/]+)\/node\/([^/]+)$/)
    if (method === 'GET' && nodeGet) {
      const sess = requireSession(req, res)
      if (!sess) return
      const nid = nodeGet[2]
      const node = nodes.get(nid)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'Node not found' })
      return json(res, 200, node)
    }

    // ── GET /fs/:fsid/node (by path) ───────────────────────────────────────
    const nodePath = pathname.match(/^\/fs\/([^/]+)\/node$/)
    if (method === 'GET' && nodePath) {
      const sess = requireSession(req, res)
      if (!sess) return
      const fid = nodePath[1]
      const path = url.searchParams.get('path') ?? '/'
      if (path.includes('..')) {
        return json(res, 400, { error: 'EINVAL', message: 'Path traversal not allowed' })
      }
      const node = resolveNode(fid, path)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'Node not found' })
      return json(res, 200, node)
    }

    // ── PATCH /fs/:fsid/node/:nid ─────────────────────────────────────────
    const nodePatch = pathname.match(/^\/fs\/([^/]+)\/node\/([^/]+)$/)
    if (method === 'PATCH' && nodePatch) {
      const sess = requireSession(req, res)
      if (!sess) return
      const nid = nodePatch[2]
      const node = nodes.get(nid)
      if (!node) return json(res, 404, { error: 'ENOENT', message: 'Node not found' })
      const body = await readBody(req) as Record<string, unknown>
      if (body.meta && typeof body.meta === 'object') {
        node.meta = { ...node.meta, ...(body.meta as Record<string, unknown>) } as NodeRecord['meta']
      }
      node.updated_at = new Date().toISOString()
      return json(res, 200, node)
    }

    // ── PATCH /session/:id ────────────────────────────────────────────────
    const sessionPatch = pathname.match(/^\/session\/([^/]+)$/)
    if (method === 'PATCH' && sessionPatch) {
      if (!requireSession(req, res)) return
      const sid = sessionPatch[1]
      const sess2 = sessions.get(sid)
      if (!sess2) return json(res, 404, { error: 'NOT_FOUND', message: 'Session not found' })
      const body = await readBody(req) as Record<string, unknown>
      const ttl = Number(body.ttl_seconds ?? 3600)
      sess2.ttl_seconds = ttl
      sess2.expires_at = new Date(Date.now() + ttl * 1000).toISOString()
      return json(res, 200, sess2)
    }

    // ── GET /fs/:fsid/watch (SSE) ──────────────────────────────────────────
    const watchGet = pathname.match(/^\/fs\/([^/]+)\/watch$/)
    if (method === 'GET' && watchGet) {
      const sess = requireSession(req, res)
      if (!sess) return
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      // Send a keep-alive comment immediately
      res.write(': keep-alive\n\n')
      // Close after a short delay (tests shouldn't hang)
      const timer = setTimeout(() => { res.end() }, 100)
      req.on('close', () => { clearTimeout(timer); res.end() })
      return
    }

    // ── Fallback ───────────────────────────────────────────────────────────
    json(res, 404, { error: 'NOT_FOUND', message: `No route: ${method} ${pathname}` })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      const baseUrl = `http://127.0.0.1:${addr.port}`
      resolve({
        baseUrl,
        sessionId,
        fsid,
        rootNid,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}

/**
 * Build a default RvfsClientConfig for the given mock server handle.
 */
export function makeConfig(
  handle: MockServerHandle,
  overrides: Partial<RvfsClientConfig> = {},
): RvfsClientConfig {
  return {
    baseUrl: handle.baseUrl,
    sessionId: handle.sessionId,
    fsid: handle.fsid,
    offlineFallback: true,
    syncOnReconnect: true,
    watchOnMount: false,
    ...overrides,
  }
}
