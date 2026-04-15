---
description: "RVFS project structure and package conventions. Apply when creating files, adding dependencies, or setting up new packages."
applyTo: "{rvfs,tools}/**"
---

# RVFS Project Structure

## Monorepo Layout

```
RVFS/
├── .specs/
│   └── vfs-remote.md          # The canonical spec — source of truth
├── .github/
│   ├── copilot-instructions.md
│   ├── agents/                # Specialist agent definitions
│   ├── instructions/          # Context instructions
│   └── prompts/               # Reusable prompt templates
├── rvfs/                      # All RVFS product packages
│   ├── rvfs-types/            # Shared TypeScript types (no runtime code)
│   ├── rvfs-server-node/      # Phase 1: Node.js Fastify server
│   ├── rvfs-client-node/      # Phase 1: Node.js system client
│   ├── rvfs-server-python/    # Phase 2: Python server (planned)
│   ├── rvfs-client-python/    # Phase 2: Python client (planned)
│   └── rvfs-client-browser/   # Phase 3: Browser client (planned)
├── tools/                     # IDE and developer tooling (not the product)
│   └── mcp-server/            # MCP server for the agent team
├── VERSION                    # Single version for all packages
├── CHANGELOG.md
├── pnpm-workspace.yaml
└── package.json               # Root workspace config
```

## Package Conventions (Node)

### `rvfs/rvfs-types`

- Private package (`"private": true`)
- No runtime code — TypeScript `d.ts` types only
- Exports: `MetaNode`, `RootMetaNode`, `DirMetaNode`, `FileMetaNode`, `BlobHeader`, `Session`,
  `RvfsError`, `IRvfsClient`, `StorageBackend`, `RvfsChangeEvent`, `LinuxMeta`, `WriteOptions`,
  `CacheStats`, `SyncResult`, `PendingWrite`
- Entry: `src/index.ts` → compiled to `dist/index.d.ts`

### `rvfs/rvfs-server-node`

```
src/
├── index.ts                   # Package entry
├── server.ts                  # createServer(config) → Fastify app
├── routes/
│   ├── fs.ts                  # /fs and /fs/:fsid routes
│   ├── node.ts                # /node/:nid routes
│   ├── blob.ts                # /blob routes
│   ├── session.ts             # /session routes
│   ├── batch.ts               # /batch route
│   ├── watch.ts               # /fs/:fsid/watch SSE route
│   └── ping.ts                # /ping route
├── storage/
│   ├── interface.ts           # Re-exports StorageBackend from rvfs-types
│   └── memory.ts              # In-memory StorageBackend implementation
├── ops/
│   ├── create.ts              # op/create logic
│   ├── write.ts               # op/write logic
│   ├── rm.ts                  # op/rm logic
│   ├── mv.ts                  # op/mv logic
│   └── cp.ts                  # op/cp logic
├── auth.ts                    # Bearer token validation middleware
├── permissions.ts             # POSIX permission check helpers
└── errors.ts                  # HTTP error formatting
tests/
├── routes/                    # Route-level integration tests
├── ops/                       # Atomic operation tests
└── storage/                   # Storage backend tests
```

### `rvfs/rvfs-client-node`

```
src/
├── index.ts                   # Package entry — exports SystemRvfsClient
├── client.ts                  # SystemRvfsClient class
├── cache/
│   ├── lru.ts                 # In-memory LRU cache
│   └── sqlite.ts              # SQLite persistent cache (optional)
├── wal/
│   ├── memory.ts              # In-memory WAL
│   └── sqlite.ts              # SQLite WAL (optional)
├── sse.ts                     # SSE client wrapper
├── sync.ts                    # Reconnect & WAL replay logic
└── http.ts                    # Fetch wrapper with auth + retry
tests/
```

## tsconfig Conventions

Every TypeScript package uses:
```json
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

## pnpm Workspace

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'rvfs/*'
  - 'tools/*'
```

Internal references use workspace protocol: `"@rvfs/types": "workspace:*"`

## Test Conventions

- Framework: **Vitest**
- All tests in `tests/` dir co-located with their package
- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- Test files must not import from `dist/` — always source imports via `src/`
- Run all tests: `pnpm test` from repo root
- Coverage threshold: 80% per package minimum
