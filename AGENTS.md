# RVFS — Remote Virtual Filesystem

The reference implementation of the RVFS specification: a storage-agnostic, session-aware,
distributed filesystem with POSIX semantics, copy-on-write forking, offline WAL sync, and
real-time SSE change streaming.

**Spec:** `.specs/vfs-remote.md` — the source of truth for all implementation decisions.

---

## Agent Team

This project is built by a team of **individual people** — each agent is a named person with
a personality and distinct working style. Multiple people can share a role and work in parallel.

| Person | Invoke | Role |
|--------|--------|------|
| **Morgan** | `@pm` | Project Manager — orchestrates team, plans releases, handles all git merges |
| **Jordan** | `@architect` | System Architect — design decisions, TypeScript types, spec interpretation |
| **Alex** | `@server-dev` | Server Dev — `rvfs/rvfs-server-node` implementation |
| **Sam** | `@client-dev` | Client Dev — `rvfs/rvfs-client-node` implementation |
| **Casey** | `@planner` | Planner — work breakdown, gap analysis, sprint planning |
| **Riley** | `@docs` | Docs — README, API docs, changelog, examples |
| **Avery** | `@qa` | QA — writes failing tests before implementation begins |
| **Quinn** | `@security` | Security — security review (OWASP, §14 checklist) |
| **Drew** | `@dx` | DX — API ergonomics, error messages, developer experience |
| **Blake** | `@reviewer` | Reviewer — code review, spec compliance review |
| **Parker** | `@mcp-dev` | MCP Dev — builds and maintains `tools/mcp-server` |
| *(factory)* | (PM only) | Agent Factory — creates new named team members |

New team members are added by Morgan via the Agent Factory. A second Server Dev, a Python Dev,
or any other specialist can be created as a named individual at any time.

### Quick Start for AI Agents

When invoked, always:
1. Read the spec section relevant to your task (`.specs/vfs-remote.md`)
2. Check the workspace instructions (`.github/copilot-instructions.md`)
3. Check the git workflow instructions (`.github/instructions/git-workflow.instructions.md`)
4. Return a structured summary of: what was done, what changed, and what needs follow-up

---

## Package Roadmap

| Phase | Package | Status |
|-------|---------|--------|
| 1 | `rvfs/rvfs-server-node` | Active development |
| 1 | `rvfs/rvfs-client-node` | Active development |
| 1 | `rvfs/rvfs-types` | Active development |
| 2 | `rvfs/rvfs-server-python` | Planned |
| 2 | `rvfs/rvfs-client-python` | Planned |
| 3 | `rvfs/rvfs-client-browser` | Planned |

---

## V1 Scope

Phase 1 implements spec §3–14:

- Node model (root, dir, file meta nodes + blob nodes)
- Filesystem graph + O(1) path resolution via `name_index`
- Linux metadata & POSIX permission enforcement
- Guest and authenticated sessions with TTL
- Forking (copy-on-write, depth capped at 1 for V1)
- Full Fastify HTTP server API (30+ endpoints)
- SystemRvfsClient with LRU cache + WAL
- Offline mode + sync-on-reconnect
- SSE change stream (`/fs/:fsid/watch`)
- RvfsError model (POSIX codes)
- Security: token isolation, server-authz, blob SHA-256, path traversal prevention, rate limiting

## V2 Scope (deferred — return 501)

- File & directory locking (§15)
- Presigned links (§16)
- Fork depth > 1 and fork merge

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Test with coverage
pnpm test --coverage
```

---

## Versioning

All packages share a single version tracked in the root `VERSION` file.
See `.github/instructions/versioning.instructions.md` for versioning rules.

---

## License

See `LICENSE`.
