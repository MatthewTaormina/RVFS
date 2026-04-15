# rvfs-client-node

> The RVFS system client for Node.js — implements `IRvfsClient` with LRU caching, offline WAL sync, SSE change streaming, and fork-aware reads.

## Installation

```bash
pnpm add rvfs-client-node
```

Requires Node.js ≥ 18.

## Quick Start

```typescript
import { SystemRvfsClient } from 'rvfs-client-node'
import { RvfsError } from 'rvfs-types'

const client = new SystemRvfsClient({
  baseUrl: process.env.RVFS_SERVER_URL!,
  sessionId: process.env.RVFS_SESSION_ID!,
  fsid: process.env.RVFS_FSID!,
})

await client.mount()

try {
  await client.writeText('/hello.txt', 'Hello, RVFS!')
  const content = await client.readText('/hello.txt')
  console.log(content) // Hello, RVFS!

  await client.mkdir('/notes', { parents: true })
  await client.writeText('/notes/todo.txt', 'Buy milk')

  const entries = await client.readdir('/notes')
  console.log(entries) // ['todo.txt']
} catch (err) {
  if (err instanceof RvfsError) {
    console.error(`RVFS error: ${err.code} — ${err.message}`)
  } else {
    throw err
  }
} finally {
  await client.unmount()
}
```

## Configuration

`SystemRvfsClient` accepts an `RvfsClientConfig` object (§10.1):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | *(required)* | RVFS server URL (e.g. `http://localhost:3000`) |
| `sessionId` | `string` | `undefined` | Bearer token from `POST /session` |
| `fsid` | `string` | *(required)* | Filesystem ID to operate on |
| `cacheMaxNodes` | `number` | `256` | Max meta nodes in the LRU cache |
| `cacheMaxBlobMb` | `number` | `32` | Max blob data in cache (MB) |
| `offlineFallback` | `boolean` | `true` | Queue writes to WAL when offline |
| `syncOnReconnect` | `boolean` | `true` | Auto-replay WAL on reconnect |
| `conflictPolicy` | `'overwrite' \| 'fail'` | `'fail'` | How to resolve WAL replay conflicts |
| `watchOnMount` | `boolean` | `true` | Open SSE stream automatically on `mount()` |
| `watchPaths` | `string[]` | `['/**']` | Glob filters for the SSE watch stream |

## API Reference

### Lifecycle

| Method | Description |
|--------|-------------|
| `mount()` | Connect to server, open SSE stream |
| `unmount()` | Close SSE, release resources |
| `online` | `boolean` — current connectivity status |

### Read Operations

| Method | Description |
|--------|-------------|
| `stat(path)` | Get `FileMetaNode \| DirMetaNode` for a path |
| `readText(path)` | Read file content as UTF-8 string |
| `readBinary(path)` | Read file content as `Uint8Array` |
| `readdir(path)` | List directory entry names |
| `readdirWithTypes(path)` | List entries with their `stat` results |
| `realpath(path)` | Resolve and normalize a path |
| `exists(path)` | Check if a path exists |
| `isFile(path)` | Check if path is a file |
| `isDir(path)` | Check if path is a directory |

### Write Operations

| Method | Description |
|--------|-------------|
| `writeText(path, content, options?)` | Write UTF-8 string to a file |
| `writeBinary(path, content, options?)` | Write binary data to a file |
| `appendText(path, content)` | Append text to a file (client-side read + write) |
| `mkdir(path, options?)` | Create a directory (`{ parents: true }` for recursive) |
| `rm(path, options?)` | Remove a file (`{ force: true }` to ignore ENOENT) |
| `rmdir(path, options?)` | Remove a directory (`{ recursive: true }` for non-empty) |
| `mv(src, dst)` | Move or rename a node |
| `cp(src, dst)` | Copy a file |
| `symlink(target, path)` | Create a symlink |

`WriteOptions` (for `writeText`/`writeBinary`):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `number` | `0o644` | Unix permission bits for new files |
| `createParents` | `boolean` | `false` | Create missing parent directories |
| `noClobber` | `boolean` | `false` | Fail if file already exists |
| `ttl` | `number` | inherited | Node TTL in seconds |

### Metadata Operations

| Method | Description |
|--------|-------------|
| `chmod(path, mode)` | Change permission bits |
| `chown(path, uid, gid)` | Change owner and group |
| `utimes(path, atime, mtime)` | Update access and modification times |

### Forking (§8)

```typescript
const fork = await client.fork({ label: 'my-experiment' })

// Fork inherits all files from the parent via copy-on-write
const content = await fork.readText('/hello.txt') // reads from parent

// Writes go to the fork only
await fork.writeText('/hello.txt', 'Modified in fork')

// Check if a path is owned by this fork (vs inherited from parent)
await fork.isOwned('/hello.txt') // true — was written to fork
```

> **V1 Limitation:** Fork depth is capped at 1. Forking an already-forked filesystem returns `FORK_DEPTH_EXCEEDED`. Fork merge (§8.4) is deferred to V2.

### Caching (§10.6, §11.1)

The client maintains an LRU in-memory cache for meta nodes and blob content. Cache is automatically invalidated by SSE events from the server.

```typescript
// Manual cache control
client.invalidate('/path/to/invalidate')

// Prefetch a directory's children into cache
await client.prefetch('/notes')

// Inspect cache stats
const stats = client.cacheStats()
console.log(stats) // { hits, misses, evictions, sizeNodes, sizeBlobBytes }
```

### WAL & Offline Mode (§10.9, §12)

When the server is unreachable and `offlineFallback` is enabled, write operations are queued to an in-memory Write-Ahead Log (WAL). On reconnect, the WAL is automatically replayed.

```typescript
// Manual sync
const result = await client.sync()
console.log(result) // { applied: 3, conflicts: 0, errors: 0, skipped: 0 }

// Inspect pending writes
const pending = await client.getPendingWrites()
```

### SSE Change Stream (§12)

```typescript
// Subscribe to all changes
const unsubscribe = client.watch((event) => {
  console.log(event.event, event.path)
})

// Subscribe to a specific path/glob
const unsub2 = client.watchPath('/notes/**', (event) => {
  console.log('Notes changed:', event.path)
})

// Lifecycle events
client.on('online', () => console.log('Connected'))
client.on('offline', () => console.log('Disconnected'))
client.on('sync:complete', (e) => console.log('Synced:', e.result))
client.on('change', (e) => console.log('Change:', e.event))

// Unsubscribe
unsubscribe()
```

### Session Management

```typescript
// Renew session TTL
await client.renewSession(7200) // extend by 2 hours

// End session
await client.endSession()
```

## Error Handling

All methods throw `RvfsError` from `rvfs-types` on failure:

| Code | Description |
|------|-------------|
| `ENOENT` | File or directory not found |
| `EEXIST` | Path already exists (with `noClobber`) |
| `EISDIR` | Expected a file, got a directory |
| `ENOTDIR` | Expected a directory, got a file |
| `EACCES` | Permission denied |
| `EINVAL` | Invalid argument (path traversal, null bytes) |
| `OFFLINE` | Server unreachable and no cached content |
| `EIO` | Blob SHA-256 integrity check failed |
| `FORBIDDEN` | Session missing, expired, or insufficient access |

## V1 Limitations

- Fork depth capped at 1 (§8). Multi-level fork chains and fork merge are deferred to V2.
- No file/directory locking (§15) — V2 feature.
- No presigned links (§16) — V2 feature.
- Cache is in-memory only. SQLite persistent cache is planned but not yet wired.
- WAL is in-memory only. SQLite WAL backend is planned but not yet wired.

## Tests

162 tests covering client operations, caching, WAL sync, SSE, and fork behavior.

```bash
pnpm test                # run all tests
pnpm test --coverage     # with v8 coverage report
```

## Dependencies

### Runtime

| Package | Purpose |
|---------|---------|
| `rvfs-types` | Shared TypeScript types (`IRvfsClient`, `MetaNode`, `RvfsError`, etc.) |

### Dev / Build

| Package | Purpose |
|---------|---------|
| `typescript` `^5.7` | Compiler — strict mode, ESM output |
| `vitest` `^2.0` | Test runner |
| `@types/node` `^22` | Node.js type definitions |

Node.js built-ins used directly: `node:crypto` (SHA-256 verification).

## License

See [LICENSE](../../LICENSE).
