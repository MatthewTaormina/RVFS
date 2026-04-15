# RVFS — Remote Virtual Filesystem

> A storage-agnostic, session-aware, distributed filesystem with POSIX semantics,
> copy-on-write forking, offline WAL sync, and real-time SSE change streaming.

The reference implementation of the [RVFS specification](.specs/vfs-remote.md).

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`rvfs/rvfs-types`](rvfs/rvfs-types/) | Shared TypeScript type definitions — no runtime code | Active |
| [`rvfs/rvfs-server-node`](rvfs/rvfs-server-node/) | Fastify HTTP server (Node.js ≥ 18) | Active |
| [`rvfs/rvfs-client-node`](rvfs/rvfs-client-node/) | System client with LRU cache + offline WAL (Node.js ≥ 18) | Active |
| `rvfs/rvfs-server-python` | Python server implementation | Planned (Phase 2) |
| `rvfs/rvfs-client-python` | Python client implementation | Planned (Phase 2) |
| `rvfs/rvfs-client-browser` | Browser client implementation | Planned (Phase 3) |
| [`tools/mcp-server`](tools/mcp-server/) | MCP server — HTTP/REST testing tools for the agent team | Active |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the server with the in-memory backend
node -e "
import { createServer, MemoryStorageBackend } from './rvfs/rvfs-server-node/dist/index.js'
const app = createServer({ storage: new MemoryStorageBackend() })
await app.listen({ port: 3000 })
console.log('RVFS listening on http://localhost:3000')
"

# Health check
curl http://localhost:3000/ping
# {"ok":true,"version":"0.1.0"}
```

## Specification

The complete RVFS specification is in [`.specs/vfs-remote.md`](.specs/vfs-remote.md).
All packages implement this spec. When in doubt, the spec wins.

**V1 scope (implemented — §3–14):** node model, filesystem graph, POSIX permissions, sessions,
TTL, copy-on-write forking (depth 1), full HTTP API, SSE change stream, error model, security.

**V2 scope (deferred — stubs return 501):** file/directory locking (§15), presigned links (§16),
multi-level fork chains, fork merge (§8.4).

## Development

Requires Node.js ≥ 18 and [pnpm](https://pnpm.io/).

```bash
pnpm install          # install all dependencies
pnpm build            # build all packages
pnpm test             # run all test suites
pnpm test --coverage  # with v8 coverage report
pnpm clean            # remove all dist/ outputs
```

Target a single package:

```bash
pnpm --filter rvfs-server-node test
pnpm --filter rvfs-types build
```

## Versioning

All packages share a single version tracked in [`VERSION`](VERSION) (`0.1.0`).
Every `package.json` must match this value.

- Breaking spec changes → bump **MAJOR**
- New V2 features → bump **MINOR**
- Bug fixes → bump **PATCH**

See [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Roadmap

**V1 (0.1.0 — complete):** Node model, filesystem graph, POSIX permissions, sessions, TTL,
copy-on-write forking (depth 1), full HTTP API, SSE change stream, error model, security.
360 tests passing (198 server, 162 client).

**V2 (planned):** File/directory locking (§15), presigned links (§16), multi-level fork chains,
fork merge (§8.4). Stubs currently return `501 Not Implemented`.

**Phase 2:** Python server and client implementations.  
**Phase 3:** Browser client implementation.

## Repository Layout

```
.specs/                  RVFS specification (source of truth)
.github/
  copilot-instructions.md  Workspace-level agent instructions
  instructions/            Per-topic instruction files (git, spec, versioning, structure)
  agents/                  Named agent definition files
rvfs/                    All package implementations (see rvfs/README.md)
  rvfs-types/
  rvfs-server-node/
  rvfs-client-node/
tools/
  mcp-server/            MCP server for agent tooling
VERSION                  Shared version string
CHANGELOG.md             Release history (Keep a Changelog format)
AGENTS.md                Agent team roster and quick-start guide
```

## License

See [LICENSE](LICENSE).