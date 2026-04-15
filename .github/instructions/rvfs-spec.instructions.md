---
description: "RVFS spec reference. Apply when implementing or reviewing any RVFS feature, endpoint, type, or behavior."
applyTo: "packages/**/*.ts"
---

# RVFS Spec Reference

The canonical specification is at `.specs/vfs-remote.md`. Read it before making implementation
decisions. The sections below are a quick-lookup digest — confirm details in the full spec.

## Node Types (§3)

| Type | `type` value | Key fields |
|------|-------------|------------|
| Root meta | `"root"` | `fsid`, `children[]`, `name_index{}`, `fork_of`, `fork_depth` |
| Directory meta | `"dir"` | `name`, `parent_nid`, `children[]`, `name_index{}`, `meta` (LinuxMeta) |
| File meta | `"file"` | `name`, `parent_nid`, `blob_nid`, `size`, `symlink_target`, `meta` |
| Blob | `"blob"` | `sha256`, `size`, `mime_type`, `ref_count` — raw binary body |

## LinuxMeta (§5)

```ts
{ mode: number, uid: number, gid: number, atime: string, mtime: string, ctime: string, nlink: number, inode: number }
```
- `inode` = lower 53 bits of SHA-256 of `nid` string
- Default file mode: `0o644`; dir: `0o755`; symlink: `0o777`

## Sessions (§6)

- Session ID = UUID v4, used as Bearer token
- Guest TTL ≤ 24 h; authenticated TTL ≤ 30 days
- `filesystems[].access` ∈ `"read" | "write" | "admin"`
- Expired/revoked sessions → `401 Unauthorized`

## TTL & Expiry (§7)

- Effective TTL = min(node.ttl, fs.ttl, session.expires_at offset)
- Soft expiry: reads return `X-Expired: true` header
- Hard expiry: `404`; soft→hard gap default 1 h

## Forking (§8) — V1 cap: fork_depth ≤ 1

- CoW: child reads fall through to parent until first write
- First write: server atomically copies parent node → child-owned nid
- Blob shared until written; then new blob created, old `ref_count` decremented
- V1: `POST /fs/{fsid}/fork` on a FS with `fork_depth > 0` → `400 FORK_DEPTH_EXCEEDED`

## Server API Endpoints (§9)

| Category | Key endpoints |
|----------|--------------|
| FS mgmt (§9.1) | `GET /fs`, `POST /fs`, `GET /fs/{fsid}`, `DELETE /fs/{fsid}`, `POST /fs/{fsid}/fork`, `PATCH /fs/{fsid}/ttl` |
| Nodes (§9.2) | `GET /node/{nid}`, `PUT /node/{nid}`, `PATCH /node/{nid}`, `DELETE /node/{nid}` |
| Blobs (§9.3) | `POST /blob`, `GET /blob/{nid}`, `HEAD /blob/{nid}`, `DELETE /blob/{nid}` |
| FS ops (§9.4) | `POST /fs/{fsid}/op/create`, `/op/read`, `/op/write`, `/op/rm`, `/op/mv`, `/op/cp` |
| Sessions (§9.5) | `POST /session`, `GET /session/{id}`, `DELETE /session/{id}`, `PATCH /session/{id}/ttl` |
| Batch (§9.6) | `POST /batch` — max 100 ops per request |
| SSE (§9.7) | `GET /fs/{fsid}/watch` — change stream with `since`, `types`, `paths` params |
| Health (§9.10) | `GET /ping` → `{ ok: true, version: string }` |

**V2 stubs (§15, §16):** Lock endpoints → `501`, Presign endpoints → `501`

## StorageBackend Interface (§9.9)

```ts
interface StorageBackend {
  getMeta(nid): Promise<MetaNode | null>
  putMeta(node): Promise<void>
  patchMeta(nid, patch): Promise<MetaNode>
  deleteMeta(nid): Promise<void>
  getBlobHeader(nid): Promise<BlobHeader | null>
  getBlob(nid): Promise<ArrayBuffer | null>
  putBlob(header, content): Promise<string>   // returns nid
  deleteBlob(nid): Promise<void>
  getFS(fsid): Promise<RootMetaNode | null>
  putFS(root): Promise<void>
  deleteFS(fsid): Promise<void>
  listFSNodes(fsid, cursor?, limit?): Promise<{ nids: string[]; cursor: string | null }>
  getSession(sessionId): Promise<Session | null>
  putSession(session): Promise<void>
  deleteSession(sessionId): Promise<void>
  listExpiredNodes(before: Date): Promise<string[]>
  listExpiredFS(before: Date): Promise<string[]>
}
```

## Error Codes (§13)

`ENOENT`, `EEXIST`, `ENOTDIR`, `EISDIR`, `EACCES`, `ELOOP`, `ENOTEMPTY`, `ENAMETOOLONG`,
`ENOSPC`, `OFFLINE`, `EXPIRED`, `FORBIDDEN`, `CONFLICT`, `ELOCKED`, `EDEADLOCK`, `TIMEOUT`

## Security Requirements (§14)

1. Session tokens: 128-bit entropy minimum (UUID v4 ✓)
2. HTTPS only for token transmission
3. Server-side authz on EVERY mutating op — never trust client-side checks alone
4. Blob SHA-256 verified on upload AND download
5. Paths: canonicalise before lookup; reject `..` escaping root → `400`
6. Quota: track blob bytes per fsid; `507` when exceeded
7. Fork depth limit: `400` when exceeded
8. Rate limits: 300 writes/session/min, 1200 reads/session/min, 429 with `Retry-After`

## WAL Entry Schema (§12.1)

```ts
{ id: string, fsid: string, op: 'create'|'write'|'rm'|'mv'|'cp'|'mkdir'|'rmdir'|'chmod'|'chown',
  path: string, args: Record<string,unknown>, queued_at: string,
  status: 'pending'|'syncing'|'done'|'conflict'|'error', retry: number, error: string|null }
```

## SSE Change Events (§9.7)

Event types: `node:create`, `node:write`, `node:meta`, `node:delete`, `node:move`,
`fs:fork`, `fs:delete`, `session:expire`, `stream:reset`

Keep-alive comment (`: keep-alive`) every 30 s. Retain event log ≥ 5 minutes for replay.
