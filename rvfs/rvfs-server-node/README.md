# rvfs-server-node

> The RVFS reference server implementation for Node.js — a storage-agnostic Fastify HTTP server implementing the Remote Virtual Filesystem specification (§3–14).

## Installation

```bash
pnpm add rvfs-server-node
```

Requires Node.js ≥ 18.

## Quick Start

```typescript
import { createServer, MemoryStorageBackend } from 'rvfs-server-node'

const storage = new MemoryStorageBackend()
const app = createServer({ storage })

await app.listen({ port: 3000, host: '0.0.0.0' })
console.log('RVFS server listening on http://localhost:3000')
```

## Configuration

`createServer` accepts an `RvfsServerConfig` object:

| Option    | Type             | Required | Description                              |
|-----------|------------------|----------|------------------------------------------|
| `storage` | `StorageBackend` | Yes      | The storage backend implementation to use |

```typescript
import type { RvfsServerConfig } from 'rvfs-server-node'

const config: RvfsServerConfig = {
  storage: new MemoryStorageBackend(),
}
```

## Storage Backends

### `MemoryStorageBackend`

An in-process, in-memory backend. All data is lost when the process exits. Suitable for testing, development, and ephemeral environments.

```typescript
import { MemoryStorageBackend } from 'rvfs-server-node'

const storage = new MemoryStorageBackend()
```

To use a persistent backend, implement the `StorageBackend` interface from `rvfs-types` and pass it to `createServer`.

## API Reference

All endpoints require a `Bearer` token in the `Authorization` header except `POST /session` and `GET /ping`. Tokens are the `session_id` returned from `POST /session`.

```
Authorization: Bearer <session_id>
```

---

### Health

#### `GET /ping`

Returns server health status. No authentication required.

**Response `200`**
```json
{ "ok": true, "version": "0.1.0" }
```

---

### Sessions (§6)

Sessions are the authentication primitive. Each session carries a list of filesystems the caller can access and the level of access for each.

#### `POST /session`

Create a new session.

**Request body**
```json
{
  "identity": "user@example.com",
  "ttl_seconds": 3600,
  "filesystems": [
    { "fsid": "fs-<uuid>", "access": "read" }
  ],
  "metadata": {}
}
```

| Field         | Type                              | Required | Description                                     |
|---------------|-----------------------------------|----------|-------------------------------------------------|
| `identity`    | `string`                          | Yes      | Caller identifier (email, user ID, etc.)        |
| `ttl_seconds` | `number`                          | Yes      | Session lifetime in seconds                     |
| `filesystems` | `Array<{ fsid, access }>`         | No       | Filesystem access grants; defaults to `[]`      |
| `metadata`    | `Record<string, unknown>`         | No       | Arbitrary key/value; defaults to `{}`           |

Access levels: `"read"` < `"write"` < `"admin"`.

**Response `201`** — the full `Session` object including the new `session_id`.

#### `GET /session/:session_id`

Retrieve a session by ID. The caller's Bearer token must be valid and non-expired.

**Response `200`** — the `Session` object.

#### `DELETE /session/:session_id`

Revoke a session. Requires a valid Bearer token.

**Response `204`** — no body.

#### `PATCH /session/:session_id/ttl`

Extend a session's TTL.

**Request body**
```json
{ "ttl_seconds": 7200 }
```

**Response `200`** — the updated `Session` object.

---

### Filesystems (§4)

#### `GET /fs`

List all filesystems the session can access. Supports cursor-based pagination.

**Query parameters**

| Param    | Type     | Description                           |
|----------|----------|---------------------------------------|
| `limit`  | `number` | Page size (default `100`, max `1000`) |
| `cursor` | `string` | `fsid` of the last item on the previous page |

**Response `200`**
```json
{
  "items": [{ "fsid": "...", "label": "...", "owner": "...", "access": "admin", "created_at": "...", "ttl": null }],
  "cursor": null,
  "has_more": false
}
```

#### `POST /fs`

Create a new filesystem. The session is automatically granted `admin` access.

**Request body**
```json
{
  "label": "my-fs",
  "ttl": null,
  "owner": "user@example.com"
}
```

**Response `201`**
```json
{
  "fsid": "fs-<uuid>",
  "root_nid": "n-<uuid>",
  "label": "my-fs",
  "created_at": "<iso8601>"
}
```

#### `GET /fs/:fsid`

Get the root `MetaNode` for a filesystem. Requires `read` access.

**Response `200`** — the `RootMetaNode` object.

#### `PATCH /fs/:fsid`

Update filesystem metadata (currently `label`). Requires `write` access.

**Request body**
```json
{ "label": "new-label" }
```

**Response `200`** — the updated `RootMetaNode`.

#### `DELETE /fs/:fsid`

Delete a filesystem and all its nodes and blobs. Requires `admin` access. Emits an `fs:delete` SSE event.

**Response `204`** — no body.

#### `GET /fs/:fsid/nodes`

List all node IDs (`nid`s) in a filesystem. Useful for bulk sync or inspection. Requires `read` access. Supports cursor-based pagination.

**Query parameters**

| Param    | Type     | Description                                    |
|----------|----------|------------------------------------------------|
| `limit`  | `number` | Page size (default `100`)                      |
| `cursor` | `string` | `nid` of the last item on the previous page    |

**Response `200`**
```json
{ "nids": ["n-...", "n-..."], "cursor": null, "has_more": false }
```

#### `PATCH /fs/:fsid/ttl`

Update the TTL of a filesystem. Requires `write` access.

**Request body**
```json
{ "ttl": 7200 }
```

Set `ttl` to `null` to remove the expiry. **Response `200`** — the updated `RootMetaNode`.

#### `POST /fs/:fsid/fork`

Create a copy-on-write fork of a filesystem. Requires `read` access on the parent. The new filesystem is automatically granted `admin` access on the calling session. (§8)

**Request body**
```json
{
  "label": "my-fs-fork",
  "ttl": null,
  "owner": "user@example.com"
}
```

**Response `201`** — the new `RootMetaNode` for the forked filesystem.

> **V1 Limitation:** Fork depth is capped at 1. Forking an already-forked filesystem returns `400 FORK_DEPTH_EXCEEDED`. Fork merge (§8.4) is deferred to V2.

---

### Nodes (§4)

Nodes are the metadata objects in the filesystem graph: `root`, `dir`, and `file` types.

#### `PUT /node/:nid`

Upsert a node by ID. Requires `write` access to the node's filesystem.

**Request body** — a full `MetaNode` object.

**Response `200`** — the stored `MetaNode`.

#### `GET /node/:nid`

Get a node by ID. Requires `read` access to the node's filesystem.

**Response `200`** — the `MetaNode` object.  
**Response `404`** — node not found.

#### `PATCH /node/:nid`

Partially update a node. Requires `write` access to the node's filesystem.

**Request body** — a partial `MetaNode` (only the fields to update).

**Response `200`** — the updated `MetaNode`.

#### `DELETE /node/:nid`

Delete a node by ID. Requires `write` access to the node's filesystem.

**Response `204`** — no body.

#### `PATCH /node/:nid/ttl`

Update the TTL of a node. Requires `write` access.

**Request body**
```json
{ "ttl": 3600 }
```

**Response `200`** — the updated `MetaNode`.

---

### Filesystem Operations (§9)

High-level path-based operations. These operate on the filesystem graph using the `name_index` for O(1) path resolution.

All operation endpoints use `POST`. Require `write` access except `op/read` which requires `read`.

| Endpoint                        | Description                              | SSE event emitted |
|---------------------------------|------------------------------------------|-------------------|
| `POST /fs/:fsid/op/create`      | Create a new file or directory at a path | `node:create`     |
| `POST /fs/:fsid/op/write`       | Write content to a file                  | `node:write`      |
| `POST /fs/:fsid/op/read`        | Read file content or list a directory    | —                 |
| `POST /fs/:fsid/op/mv`          | Move/rename a node                       | `node:move`       |
| `POST /fs/:fsid/op/cp`          | Copy a node (shallow copy)               | —                 |
| `POST /fs/:fsid/op/rm`          | Remove a node                            | `node:delete`     |

**`op/create` request body**
```json
{ "path": "/notes/hello.txt", "type": "file", "content": "optional initial text", "meta": { "mode": 420 } }
```
`type` is `"file"`, `"dir"`, or `"symlink"` (symlink requires `symlink_target`). `content` and `meta` are optional.

**`op/write` request body**
```json
{ "path": "/notes/hello.txt", "content": "new content", "create_if_missing": false, "append": false }
```

**`op/read` request body**
```json
{ "path": "/notes/hello.txt" }
```

**`op/mv` and `op/cp` request body**
```json
{ "src": "/old/path", "dst": "/new/path" }
```
`op/cp` also accepts `"recursive": true` for directory copies.

**`op/rm` request body**
```json
{ "path": "/notes/hello.txt", "recursive": false }
```
`recursive: true` is required to remove a non-empty directory.

---

### Blobs (§10)

Blobs store raw binary content. Every blob is SHA-256 verified on upload.

#### `POST /blob`

Upload binary content. Content-Type must be `application/octet-stream`.

**Query parameters**

| Param       | Type     | Required | Description                               |
|-------------|----------|----------|-------------------------------------------|
| `fsid`      | `string` | Yes      | The filesystem this blob belongs to       |
| `sha256`    | `string` | No       | Expected SHA-256 hex digest; verified if provided |
| `mime_type` | `string` | No       | MIME type; defaults to `application/octet-stream` |

**Response `201`**
```json
{
  "nid": "n-<uuid>",
  "sha256": "<hex>",
  "size": 1024,
  "mime_type": "image/png"
}
```

> **Security:** The server independently computes SHA-256 on every upload. If `sha256` is provided and does not match the computed digest, the request is rejected with `400 EINVAL`. (§14.3)

#### `GET /blob/:nid`

Download blob content. Requires `read` access to the blob's filesystem.

**Response `200`** — raw binary body with `Content-Type` set to the blob's `mime_type` and `X-Blob-SHA256` header containing the SHA-256 digest.

#### `DELETE /blob/:nid`

Delete a blob. Requires `write` access to the blob's filesystem.

**Response `204`** — no body.

---

### Batch (§11)

Execute multiple API calls in a single HTTP round-trip. Up to 100 operations per request.

#### `POST /batch`

**Request body**
```json
{
  "requests": [
    { "id": "op1", "method": "GET", "path": "/fs/fs-abc/op/read?path=/hello.txt" },
    { "id": "op2", "method": "POST", "path": "/fs/fs-abc/op/create", "body": { "path": "/notes", "type": "dir" } }
  ]
}
```

**Response `200`**
```json
{
  "responses": [
    { "id": "op1", "status": 200, "body": { ... } },
    { "id": "op2", "status": 201, "body": { ... } }
  ]
}
```

Each sub-request inherits the caller's `Authorization` header. Individual failures return per-item error statuses without failing the whole batch.

---

### SSE Change Stream (§12)

#### `GET /fs/:fsid/watch`

Subscribe to real-time change events for a filesystem as a Server-Sent Events stream. Requires `read` access.

The server replays up to the last 200 buffered events on connect, so short-lived disconnections do not cause missed events.

**Response** — `text/event-stream` stream. Each event:
```
event: node:create
data: {"event_id":"...","event":"node:create","fsid":"...","nid":"...","path":"/file.txt","at":"..."}
```

**Event types**

| Event         | Trigger                                      |
|---------------|----------------------------------------------|
| `fs:delete`   | Filesystem deleted (`DELETE /fs/:fsid`)      |
| `fs:fork`     | Filesystem forked (`POST /fs/:fsid/fork`)    |
| `node:create` | Node created (`op/create`)                   |
| `node:write`  | File content written (`op/write`)            |
| `node:delete` | Node removed (`op/rm`)                       |
| `node:move`   | Node moved or renamed (`op/mv`)              |

---

## Error Handling

All errors are returned as JSON with an `error` field containing a POSIX-derived code.

```json
{
  "error": "ENOENT",
  "message": "Node not found",
  "path": "/missing/file.txt"
}
```

**Common error codes**

| Code               | HTTP | Description                                        |
|--------------------|------|----------------------------------------------------|
| `ENOENT`           | 404  | Node, blob, or filesystem not found                |
| `EEXIST`           | 409  | A node already exists at the target path           |
| `ENOTDIR`          | 400  | Expected a directory, found a file                 |
| `EISDIR`           | 400  | Expected a file, found a directory                 |
| `EACCES`           | 403  | POSIX permission denied (uid/gid/mode check)       |
| `ENOTEMPTY`        | 400  | Directory is not empty                             |
| `EINVAL`           | 400  | Invalid argument or missing required field         |
| `FORBIDDEN`        | 401/403 | Session missing, expired, revoked, or insufficient access level |
| `FORK_DEPTH_EXCEEDED` | 400 | V1 fork depth limit (1) exceeded                |
| `NOT_IMPLEMENTED`  | 501  | V2-deferred feature                               |

---

## Permissions (§5)

POSIX permission bits are enforced on file and directory nodes. The server evaluates `mode`, `uid`, and `gid` against the session's `uid`/`gid` for every `read`, `write`, and `execute` operation.

- `uid === 0` (root) bypasses all permission checks.
- Owner bits (bits 6–8) apply when `callerUid === fileUid`.
- Group bits (bits 3–5) apply when `callerGid === fileGid`.
- Other bits (bits 0–2) apply otherwise.

The `checkPermission` utility is exported for use in custom storage backends or middleware:

```typescript
import { checkPermission } from 'rvfs-server-node'

const canWrite = checkPermission(
  0o644,   // mode
  1000,    // fileUid
  1000,    // fileGid
  1000,    // callerUid
  1000,    // callerGid
  'write', // operation
)
// false — owner has rw (6), no write bit for this operation? 6 & 2 = 2 → true
```

---

## V1 Limitations

The following features are defined in the RVFS spec but are **not implemented** in V1. Calling these endpoints returns `501 Not Implemented`.

> **V2 Feature:** File and directory locking (§15 of the RVFS spec) is not implemented in V1.
> `POST /lock` and `DELETE /lock/:lockId` return `501 Not Implemented`. Planned for a future minor release.

> **V2 Feature:** Presigned links (§16 of the RVFS spec) are not implemented in V1.
> `POST /presign` and `GET /presigned/:token` return `501 Not Implemented`. Planned for a future minor release.

> **V1 Limitation:** Fork depth is capped at 1 (§8). `POST /fs/:fsid/fork` on an already-forked filesystem returns `400 FORK_DEPTH_EXCEEDED`. Multi-level fork chains and fork merge (§8.4) are deferred to V2.

---

## ID Format Conventions

All IDs are generated with `crypto.randomUUID()` (Node.js built-in, no external dependency).

| ID type      | Format          | Example                             |
|--------------|-----------------|-------------------------------------|
| `fsid`       | `fs-{uuid-v4}`  | `fs-3a7c1b2d-...`                   |
| `nid`        | `n-{uuid-v4}`   | `n-8f2e4a91-...`                    |
| `session_id` | `{uuid-v4}`     | `4e9b3f12-...` (also the Bearer token) |

The `fs-` and `n-` prefixes are a readability convention; they are not enforced by the spec.

---

## Source File Map

```
src/
├── index.ts              Public package exports
├── server.ts             createServer() — Fastify app factory, route registration, global error handler
├── auth.ts               validateSession(), assertFsAccess() — Bearer token validation and access-level enforcement
├── errors.ts             RvfsError class — POSIX-coded error with optional path, nid, and HTTP status
├── permissions.ts        checkPermission() — POSIX mode/uid/gid bit evaluation
├── storage/
│   ├── interface.ts      Re-exports StorageBackend from rvfs-types (convenience re-export for consumers)
│   └── memory.ts         MemoryStorageBackend — full in-process StorageBackend implementation
├── routes/
│   ├── ping.ts           GET /ping — health check, no auth
│   ├── session.ts        POST/GET/DELETE/PATCH /session — session lifecycle
│   ├── fs.ts             GET|POST /fs, GET|PATCH|DELETE /fs/:fsid, POST /fs/:fsid/fork — filesystem CRUD + SSE emission
│   ├── node.ts           PUT|GET|PATCH|DELETE /node/:nid, PATCH /node/:nid/ttl — raw meta node CRUD
│   ├── blob.ts           POST /blob, GET|DELETE /blob/:nid — binary blob upload/download with SHA-256 verification
│   ├── batch.ts          POST /batch — fanout up to 100 sub-requests via app.inject()
│   └── watch.ts          GET /fs/:fsid/watch — SSE change stream with 200-event replay ring buffer
└── ops/
    ├── create.ts         createNodeOp(), canonicalizePath(), resolvePath() — path-based node creation, O(1) name_index resolution
    ├── write.ts          writeNodeOp(), readNodeOp() — file content write/read with blob lifecycle management
    ├── mv.ts             mvNodeOp() — atomic move/rename with name_index update on source and destination
    ├── rm.ts             rmNodeOp() — recursive or single-node deletion with blob ref_count decrement
    └── cp.ts             cpNodeOp() — shallow/recursive copy with new nids and blob ref_count increment
```

## Test File Map

Tests use [Vitest](https://vitest.dev/) and Fastify's `app.inject()` — no real network required.
198 tests covering all spec sections §3–14.
Coverage threshold: **80% lines / functions / branches / statements**.

```
tests/
├── setup.ts                     Shared helpers: makeServer(), createSession(), createFs(), opCreate()
├── auth.test.ts                 §6.4, §14 — Bearer token enforcement, expired sessions, revoked sessions
├── permissions.test.ts          §5.1 — checkPermission() unit tests covering owner/group/other bits and root bypass
├── routes/
│   ├── ping.test.ts             §9.10 — public health check, no auth required
│   ├── session.test.ts          §6 — session create/get/delete/TTL renew
│   ├── fs.test.ts               §9.1 — filesystem CRUD, fork, pagination, access gates
│   ├── node.test.ts             §4 — raw node PUT/GET/PATCH/DELETE, TTL update
│   ├── blob.test.ts             §10 — blob upload/download, SHA-256 verification, delete
│   ├── batch.test.ts            §11 — batch fanout, per-item error isolation, 100-op limit
│   └── watch.test.ts            §12 — SSE stream connection, event replay, auth gate
├── ops/
│   ├── create.test.ts           §9.4 — file/dir create, EEXIST, ENOENT parent, createParents
│   ├── write.test.ts            §9.4 — write/read content, append, create_if_missing
│   ├── mv.test.ts               §9.4 — move, rename, cross-dir move, ENOENT/EEXIST errors
│   ├── rm.test.ts               §9.4 — rm, recursive rm, ENOTEMPTY guard
│   └── cp.test.ts               §9.4 — shallow copy, recursive copy, EEXIST guard
└── storage/
    └── memory.test.ts           §9.9 — MemoryStorageBackend interface contract tests
```

Run tests:

```bash
pnpm test               # run all tests
pnpm test --coverage    # with v8 coverage report
```

## Dependencies

### Runtime

| Package      | Version  | Purpose                                                |
|--------------|----------|--------------------------------------------------------|
| `fastify`    | `^4.0.0` | HTTP server framework                                  |
| `zod`        | `^3.0.0` | Schema validation (request body parsing)               |
| `rvfs-types` | `workspace:*` | Shared TypeScript types — `StorageBackend`, `MetaNode`, `Session`, etc. |

### Dev / Build

| Package              | Purpose                            |
|----------------------|------------------------------------|
| `typescript` `^5.7`  | Compiler — strict mode, ESM output |
| `vitest` `^2.0`      | Test runner                        |
| `@types/node` `^22`  | Node.js type definitions           |
| `rimraf` `^6`        | `clean` script                     |

Node.js built-ins used directly (no install needed): `node:crypto` (SHA-256, `randomUUID`), `node:events` (`EventEmitter` for SSE fan-out).

## License

See [LICENSE](../../LICENSE).
