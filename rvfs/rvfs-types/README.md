# rvfs-types

> Shared TypeScript type definitions for all RVFS packages — no runtime code, types only.

This is a **private** package (`"private": true`). It is not published to npm. All other
packages in the monorepo reference it via `"rvfs-types": "workspace:*"`.

## Installation

Not published. Referenced internally:

```json
"dependencies": {
  "rvfs-types": "workspace:*"
}
```

## Source File Map

```
src/
├── index.ts      Re-exports everything from all modules (the only import path consumers need)
├── meta.ts       LinuxMeta, RootMetaNode, DirMetaNode, FileMetaNode, MetaNode union (§3, §5)
├── blob.ts       BlobHeader (§3.2)
├── session.ts    Session, SessionAccess, SessionFilesystem, SessionStatus (§6)
├── error.ts      RvfsErrorCode union, RvfsError interface (§13)
├── events.ts     RvfsChangeEvent, RvfsChangeEventType — SSE wire format (§9.7, §12)
├── storage.ts    StorageBackend interface — the contract all server backends must satisfy (§9.9)
└── client.ts     IRvfsClient interface, WriteOptions, CacheStats, SyncResult, PendingWrite (§10)
```

## Type Reference

### `meta.ts` — Node model (§3, §5)

#### `LinuxMeta`

POSIX metadata stored on every `dir` and `file` node.

| Field   | Type     | Description                                          |
|---------|----------|------------------------------------------------------|
| `mode`  | `number` | Unix permission bits (e.g. `0o755` stored as decimal)|
| `uid`   | `number` | Owner user ID (`0` = root)                           |
| `gid`   | `number` | Owner group ID                                       |
| `atime` | `string` | Last access time — ISO-8601                          |
| `mtime` | `string` | Last content modification time — ISO-8601            |
| `ctime` | `string` | Last metadata change time — ISO-8601                 |
| `nlink` | `number` | Hard link count (always ≥ 1)                         |
| `inode` | `number` | Virtual inode — lower 53 bits of SHA-256 of the `nid`|

#### `RootMetaNode`

Entry point of a filesystem (`type: 'root'`). Identified by `fsid`. Holds the top-level `name_index` for O(1) path resolution.

Key fields: `fsid`, `label`, `ttl`, `owner`, `fork_of`, `fork_depth`, `children`, `name_index`.

#### `DirMetaNode`

A directory (`type: 'dir'`). Has its own `children` array and `name_index`.

Key fields: `name`, `parent_nid`, `fsid`, `ttl`, `meta` (`LinuxMeta`), `children`, `name_index`.

#### `FileMetaNode`

A file (`type: 'file'`). Points to a blob via `blob_nid` (null when empty).

Key fields: `name`, `parent_nid`, `fsid`, `ttl`, `meta` (`LinuxMeta`), `blob_nid`, `size`.

#### `MetaNode`

```typescript
export type MetaNode = RootMetaNode | DirMetaNode | FileMetaNode
```

The discriminated union used in `StorageBackend` methods and all route handlers. Discriminant is `type`.

---

### `blob.ts` — Blob model (§3.2)

#### `BlobHeader`

JSON metadata stored alongside raw binary blob content.

| Field       | Type            | Description                                          |
|-------------|-----------------|------------------------------------------------------|
| `nid`       | `string`        | Node ID — `n-{uuid}`                                 |
| `type`      | `'blob'`        | Always `'blob'`                                      |
| `fsid`      | `string`        | Owning filesystem                                    |
| `size`      | `number`        | Byte count of the raw content                        |
| `mime_type` | `string`        | IANA media type (e.g. `text/plain; charset=utf-8`)   |
| `sha256`    | `string`        | Hex-encoded SHA-256 of content — integrity check     |
| `created_at`| `string`        | ISO-8601                                             |
| `ttl`       | `number \| null` | Seconds until expiry; `null` = never                |
| `ref_count` | `number`        | Number of `FileMetaNode`s pointing to this blob (CoW GC) |

---

### `session.ts` — Sessions (§6)

#### `SessionAccess`

```typescript
type SessionAccess = 'read' | 'write' | 'admin'
```

Access levels are ordered: `read` < `write` < `admin`. A session with `write` access implicitly has `read` access.

#### `Session`

| Field         | Type                        | Description                                              |
|---------------|-----------------------------|----------------------------------------------------------|
| `session_id`  | `string`                    | UUID v4 — doubles as the Bearer token                    |
| `identity`    | `'guest' \| string`         | `'guest'` for anonymous; a user ID for authenticated     |
| `created_at`  | `string`                    | ISO-8601                                                 |
| `expires_at`  | `string`                    | ISO-8601                                                 |
| `ttl_seconds` | `number`                    | Requested TTL at creation time                           |
| `filesystems` | `SessionFilesystem[]`       | Per-filesystem access grants                             |
| `metadata`    | `Record<string, unknown>`   | Arbitrary host application context                       |

---

### `error.ts` — Error model (§13)

#### `RvfsErrorCode`

All valid error codes as a TypeScript union type. Standard POSIX codes plus RVFS-specific codes:

| Code          | Description                                              |
|---------------|----------------------------------------------------------|
| `ENOENT`      | No such file or directory                                |
| `EEXIST`      | File or directory already exists                         |
| `EACCES`      | POSIX permission denied                                  |
| `EPERM`       | Operation not permitted                                  |
| `ENOTDIR`     | Expected a directory, found a file                       |
| `EISDIR`      | Expected a file, found a directory                       |
| `ENOTEMPTY`   | Directory is not empty                                   |
| `EINVAL`      | Invalid argument                                         |
| `EIO`         | I/O error                                                |
| `ENOSPC`      | No space left (quota exceeded)                           |
| `ENOTIMPL`    | Feature not yet implemented (V2 stubs — HTTP 501)        |
| `OFFLINE`     | Remote unavailable and no cache entry                    |
| `EXPIRED`     | Node or filesystem has hard-expired                      |
| `FORBIDDEN`   | Session missing, expired, revoked, or insufficient level |
| `CONFLICT`    | WAL replay conflict during sync                          |
| `ELOCKED`     | Path locked by another session (§15 — V2)               |
| `EDEADLOCK`   | Lock acquisition would create a cycle (§15.6 — V2)      |
| `TIMEOUT`     | Remote request timed out or rate-limited (HTTP 429)      |

---

### `events.ts` — SSE change stream (§9.7, §12)

#### `RvfsChangeEvent`

The envelope emitted by the server on `GET /fs/:fsid/watch`.

| Field        | Type                     | Description                                              |
|--------------|--------------------------|----------------------------------------------------------|
| `event_id`   | `string`                 | UUID v4 — for client-side deduplication                  |
| `event`      | `RvfsChangeEventType`    | Discriminant — see table below                           |
| `fsid`       | `string`                 | Affected filesystem                                      |
| `nid`        | `string \| null`         | Affected node; null for `fs:*` events                    |
| `path`       | `string \| null`         | Resolved VFS path at time of change                      |
| `old_path`   | `string \| null`         | Previous path — non-null only for `node:move`            |
| `session_id` | `string`                 | Session that caused the mutation                         |
| `at`         | `string`                 | ISO-8601 server timestamp                                |
| `meta_delta` | `Partial<LinuxMeta> \| null` | Changed metadata fields — non-null only for `node:meta` |

#### `RvfsChangeEventType`

`'node:create' | 'node:write' | 'node:meta' | 'node:delete' | 'node:move' | 'fs:fork' | 'fs:delete' | 'session:expire' | 'stream:reset'`

---

### `storage.ts` — StorageBackend interface (§9.9)

The contract every server storage implementation must satisfy. The HTTP route layer couples only to this interface — never to a concrete class.

```typescript
interface StorageBackend {
  // Meta nodes
  getMeta(nid: string): Promise<MetaNode | null>
  putMeta(node: MetaNode): Promise<void>
  patchMeta(nid: string, patch: Partial<MetaNode>): Promise<MetaNode>
  deleteMeta(nid: string): Promise<void>

  // Blobs
  getBlobHeader(nid: string): Promise<BlobHeader | null>
  getBlob(nid: string): Promise<ArrayBuffer | null>
  putBlob(header: BlobHeader, content: ArrayBuffer): Promise<string>
  deleteBlob(nid: string): Promise<void>

  // Filesystem root
  getFS(fsid: string): Promise<RootMetaNode | null>
  putFS(root: RootMetaNode): Promise<void>
  deleteFS(fsid: string): Promise<void>   // MUST cascade-delete all nodes owned by fsid

  // Sessions
  getSession(sessionId: string): Promise<Session | null>
  putSession(session: Session): Promise<void>
  deleteSession(sessionId: string): Promise<void>
}
```

Implement this interface to plug in any persistent storage (PostgreSQL, SQLite, S3, etc.) without changing the HTTP layer.

---

### `client.ts` — Client interface and types (§10)

#### `WriteOptions`

Options accepted by client `writeText()` / `writeBinary()` methods.

| Field           | Type      | Default  | Description                                        |
|-----------------|-----------|----------|----------------------------------------------------|
| `mode`          | `number`  | `0o644`  | Unix permission bits for a newly-created file      |
| `createParents` | `boolean` | `false`  | Create missing parent directories automatically    |
| `noClobber`     | `boolean` | `false`  | Fail with `EEXIST` if the file already exists      |
| `ttl`           | `number`  | —        | Node TTL in seconds; inherits filesystem TTL if unset |

#### `SyncResult`

Return value of `client.sync()` after WAL replay (§10.9).

| Field       | Type     | Description                                   |
|-------------|----------|-----------------------------------------------|
| `applied`   | `number` | WAL entries successfully replayed             |
| `conflicts` | `number` | Entries that landed in `'conflict'` status    |
| `errors`    | `number` | Entries that landed in `'error'` status       |
| `skipped`   | `number` | Already-`'done'` entries skipped as idempotent|

#### `PendingWrite`

A single offline WAL entry (§10.9, §12.1).

| Field       | Type       | Description                                        |
|-------------|------------|----------------------------------------------------|
| `id`        | `string`   | UUID                                               |
| `op`        | `string`   | One of `create \| write \| rm \| mv \| cp \| mkdir \| rmdir \| chmod \| chown` |
| `path`      | `string`   | Target VFS path                                    |
| `args`      | `Record`   | Op-specific payload (mirrors `POST /fs/:fsid/op/*` body) |
| `status`    | `string`   | `pending \| syncing \| done \| conflict \| error`  |
| `retry`     | `number`   | Retry attempt count                                |

## Dependencies

No runtime dependencies. Build-only:

| Package      | Version  | Purpose         |
|--------------|----------|-----------------|
| `typescript` | `^5.7`   | Compiler        |
| `rimraf`     | `^6`     | `clean` script  |

## License

See [LICENSE](../../LICENSE).
