# rvfs/ — RVFS Package Implementations

This directory contains all RVFS package implementations as a pnpm workspace.
Every package implements the same [RVFS specification](../.specs/vfs-remote.md) and shares the
single version number tracked in [`../VERSION`](../VERSION).

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`rvfs-types`](./rvfs-types/) | Shared TypeScript type definitions — no runtime code | Active |
| [`rvfs-server-node`](./rvfs-server-node/) | Reference Fastify HTTP server | Active |
| [`rvfs-client-node`](./rvfs-client-node/) | Reference Node.js system client | In progress |

## Package Dependency Graph

```
rvfs-server-node  ──depends on──▶  rvfs-types
rvfs-client-node  ──depends on──▶  rvfs-types
```

`rvfs-types` has no runtime dependencies. It is a build-time-only package.

## Spec Scope per Package

| Spec section | rvfs-types | rvfs-server-node | rvfs-client-node |
|---|---|---|---|
| §3 Node model | ✅ Types | ✅ Implemented | — |
| §4 Filesystem graph | ✅ Types | ✅ Implemented | — |
| §5 POSIX permissions | ✅ Types | ✅ Implemented | — |
| §6 Sessions | ✅ Types | ✅ Implemented | — |
| §8 Forking (CoW, depth 1) | ✅ Types | ✅ Implemented | — |
| §9 HTTP API | ✅ Types | ✅ Implemented | — |
| §10 Client model | ✅ Types | — | In progress |
| §11 Batch | ✅ Types | ✅ Implemented | — |
| §12 SSE change stream | ✅ Types | ✅ Implemented | — |
| §13 Error model | ✅ Types | ✅ Implemented | — |
| §14 Security | — | ✅ Implemented | — |
| §15 Locking | — | 501 stub | Deferred (V2) |
| §16 Presigned links | — | 501 stub | Deferred (V2) |

## Development

Run all commands from the **monorepo root** with pnpm:

```bash
pnpm install          # install all package dependencies
pnpm build            # build all packages (tsc)
pnpm test             # run all test suites
pnpm clean            # remove all dist/ outputs
```

Or target a single package:

```bash
pnpm --filter rvfs-server-node test
pnpm --filter rvfs-types build
```

## Versioning

All packages share the version in [`../VERSION`](../VERSION) (`0.1.0`).
Every `package.json` must match. See the
[versioning instructions](../.github/instructions/versioning.instructions.md) before bumping.
