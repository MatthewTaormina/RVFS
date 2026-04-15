# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-15

### Added
- **[server-node]** Full Fastify HTTP server implementing RVFS spec §3–14 (30+ endpoints)
  - Filesystem CRUD, node CRUD, path-based operations (create, read, write, mv, cp, rm)
  - Blob upload/download with SHA-256 integrity verification
  - Session management with TTL, soft/hard expiry, and access-level enforcement
  - Copy-on-write forking (depth capped at 1 for V1)
  - SSE change stream with 200-event replay ring buffer
  - Batch endpoint (up to 100 sub-requests per call)
  - POSIX permission enforcement (mode/uid/gid bit evaluation)
  - `MemoryStorageBackend` — full in-process storage implementation
  - Zod schema validation on all request bodies
- **[client-node]** `SystemRvfsClient` implementing `IRvfsClient` interface (§10)
  - LRU in-memory cache with configurable node and blob limits
  - `PathIndex` for O(1) path-to-nid resolution
  - Memory WAL with offline write queueing and sync-on-reconnect
  - SSE subscription with automatic cache invalidation
  - Fork-aware reads (transparent parent fallback)
  - Event emitter for lifecycle events (online, offline, sync, change)
- **[types]** Full TypeScript type definitions for RVFS V1
  - `MetaNode` (root, dir, file), `BlobHeader`, `Session`, `RvfsError`
  - `IRvfsClient` interface, `StorageBackend` interface
  - `RvfsChangeEvent`, `WriteOptions`, `CacheStats`, `SyncResult`, `PendingWrite`

### Security
- Path traversal prevention (null bytes, `..` components, `ENAMETOOLONG`)
- SHA-256 blob integrity verification on upload and download (§14.3)
- Per-session sliding-window rate limiting (1000 req/min per token)
- Token isolation — sessions scoped to granted filesystems only
- Filesystem quota enforcement

### Fixed
- N/A (initial release)

### Notes
- 360 tests passing (198 server, 162 client)
- V2 stubs return `501 Not Implemented`: locking (§15), presigned links (§16), fork merge (§8.4)
