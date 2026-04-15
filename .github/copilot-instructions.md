# RVFS — Workspace Instructions

## Project Overview

This is the **RVFS monorepo** — the reference implementation of the Remote Virtual Filesystem
specification. RVFS is a storage-agnostic, session-aware, distributed filesystem with POSIX
semantics, copy-on-write forking, offline WAL sync, and a real-time SSE change stream.

**Spec source of truth:** `.specs/vfs-remote.md` — always consult this before making decisions.

---

## Package Roadmap

| Phase | Package | Status |
|-------|---------|--------|
| 1 | `rvfs/rvfs-server-node` | Active development |
| 1 | `rvfs/rvfs-client-node` | Active development |
| 2 | `rvfs/rvfs-server-python` | Planned |
| 2 | `rvfs/rvfs-client-python` | Planned |
| 3 | `rvfs/rvfs-client-browser` | Planned |

All packages implement the **same spec**. The Node packages come first and establish patterns
that later language ports must mirror faithfully.

---

## Spec Scope: V1 vs V2

**V1 (implement now — sections §3–14):**
- Node model: root/dir/file meta nodes + blob nodes
- Filesystem graph + path resolution
- Linux metadata & POSIX permissions
- Sessions (guest + authenticated)
- TTL & soft/hard expiry
- Forking (CoW; V1 caps fork_depth at 1)
- Full server HTTP API (§9.1–9.10): FS management, node CRUD, blob ops, atomic ops, batch, SSE, `/ping`
- Browser & System client packages + caching (LRU in-memory + platform-specific persistent)
- Offline WAL + sync protocol
- Error model (RvfsError, POSIX codes)
- Security (token isolation, server-side authz, blob SHA-256, path traversal, quota, rate limiting)

**V2 (defer — stubs return 501):**
- File & directory locking (§15)
- Presigned links (§16)
- Multi-level fork chains (depth > 1)
- Fork merge (§8.4)

---

## Technology Stack (Node Packages)

| Concern | Choice |
|---------|--------|
| Language | TypeScript 5.x, strict mode, ESM modules |
| Node version | ≥ 18 (aligned with spec's system client baseline) |
| HTTP server | Fastify 4.x |
| Test runner | Vitest |
| Package manager | pnpm workspaces |
| Schema validation | Zod |
| UUID generation | `crypto.randomUUID()` (native) |
| SQLite (optional WAL) | `better-sqlite3` (peer dep) |

---

## Unified Versioning

All packages in this monorepo share a **single version number** tracked in the root `VERSION` file.
- Format: `MAJOR.MINOR.PATCH` (semver)
- All `package.json` files reference `"version"` identical to `VERSION`
- Changelog maintained in `CHANGELOG.md` at repo root
- Breaking spec changes bump MAJOR; new V2 features bump MINOR; fixes bump PATCH
- The version reflects spec compliance level, not individual package maturity

---

## Key Type Definitions

All shared TypeScript types live in `rvfs/rvfs-types` (a private package, no runtime code).
- `MetaNode` — union of `RootMetaNode | DirMetaNode | FileMetaNode`
- `BlobHeader` — blob metadata
- `Session` — session object  
- `RvfsError` — error class with `code`, `path?`, `nid?`, `status?`
- `IRvfsClient` — the shared interface all client implementations satisfy
- `StorageBackend` — the abstract server storage interface
- `RvfsChangeEvent` — SSE event payload

---

## Node ID & File ID Rules

- All IDs: UUID v4 via `crypto.randomUUID()` unless content-addressed (optional blob optimisation)
- `fsid` prefix convention: `fs-{uuid}` (for readability in logs, NOT enforced by spec)
- `nid` prefix convention: `n-{uuid}`
- Session IDs: bare UUID v4 (used as bearer tokens — 128 bits entropy minimum)

---

## Agent Team

This project is built by a **team of individual people**, each implemented as a named agent.
Every agent has a first name, a personality, and a distinct working style. Multiple people
can hold the same role (e.g., two Server Devs) and work in parallel on separate worktrees.
New team members are created by Morgan (PM) via the Agent Factory.

| Person | Role | Invoke as |
|--------|------|-----------|
| **Morgan** | Project Manager — orchestrates team, tracks progress, handles all git merges | `@pm` |
| **Jordan** | System Architect — design decisions, TypeScript types, spec interpretation | `@architect` |
| **Alex** | Server Dev — `rvfs/rvfs-server-node` implementation | `@server-dev` |
| **Sam** | Client Dev — `rvfs/rvfs-client-node` implementation | `@client-dev` |
| **Casey** | Planner — work breakdown, gap analysis, milestone planning | `@planner` |
| **Riley** | Docs — README, API docs, usage guides, changelog | `@docs` |
| **Avery** | QA — test strategy, test code, coverage analysis | `@qa` |
| **Quinn** | Security — security review, OWASP compliance | `@security` |
| **Drew** | DX — developer experience, API ergonomics, examples | `@dx` |
| **Blake** | Reviewer — code quality, spec compliance review | `@reviewer` |
| **Parker** | MCP Dev — builds and maintains `tools/mcp-server` | `@mcp-dev` |
| *(factory)* | Agent Factory — creates new named team members (PM only) | internal |

---

## Git Workflow & TDD

See `.github/instructions/git-workflow.instructions.md` for the full protocol. Key rules:

### Branch Naming
Each person branches as `{first-name}/{feature}` — e.g., `alex/session-api`, `avery/session-api-tests`.

### TDD — Tests Before Implementation
1. **Avery (QA)** writes failing tests on `avery/{feature}-tests` and commits with `test:` prefix.
2. **Avery notifies the developer** with: branch name, test file paths, spec sections covered.
3. **Developer branches from Avery's test branch** and implements until green.
4. **Avery reviews** the passing implementation before signalling Morgan for merge.

### Worktrees
Each person working on a feature creates a worktree at `.worktrees/{branch-name}/`.
Every worktree root must contain a `WORKLOG.md` updated before every commit.

```bash
git worktree add .worktrees/alex-session-api alex/session-api
```

**Morgan is the only person who merges to `main`.** All other agents push to their own branches.

### Gitignore Gate
Before every commit, verify: `git status` shows no `node_modules/`, `dist/`, `.env*`, or `.worktrees/` files.

### Conventional Commits
```
feat:      New feature implementing a spec requirement
fix:       Bug fix
test:      Test code (must precede feat: for that feature — TDD)
refactor:  Code restructuring (no behaviour change)
docs:      Documentation only
chore:     Build, config, tooling
security:  Security fix
```

### Python Environments
Each Python package uses a local `.venv/` — never activate a global environment.
```bash
python -m venv .venv
.venv/Scripts/activate   # Windows
.venv/bin/activate       # Unix
pip install -e ".[dev]"
```

---

## Coordination Protocol

1. **PM is the entry point** for any multi-agent task. The PM breaks work into tasks, delegates
   to specialists, integrates results, and maintains the project todo list.
2. **Agents return structured output** — always summarise: what was done, what changed, what
   needs follow-up, and any blockers encountered.
3. **Spec compliance first** — when in doubt, the spec wins. Flag spec gaps to the Architect.
4. **No cross-package version drift** — every package.json version must match `VERSION`. The
   PM enforces this before any release.
5. **V2 stubs** — endpoints/features deferred to V2 MUST return `501 Not Implemented` with a
   JSON body `{"error": "NOT_IMPLEMENTED", "feature": "...", "since": "v2"}`.
6. **Security review gate** — the Security agent reviews all auth, token, and permission code
   before it is merged.
