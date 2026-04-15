---
description: "Versioning and release rules for the RVFS monorepo. Apply when changing package.json versions, creating releases, or updating the changelog."
applyTo: "**/package.json"
---

# RVFS Unified Versioning Rules

## Single Version Strategy

All packages share **one version** from the root `VERSION` file.

```
MAJOR.MINOR.PATCH   (semver)
```

### What triggers each version bump

| Bump | When |
|------|------|
| MAJOR | Breaking spec change (removes/renames API, changes request/response shape) |
| MINOR | Additive spec compliance (new V2 feature, new optional field, new endpoint) |
| PATCH | Bug fix, performance improvement, internal refactor, doc update |

### 0.x Initial Development Rules

While the version is `0.x.y`, treat MINOR as MAJOR (breaking changes allowed in minors).

## Files to Update on Every Release

1. `VERSION` — the single source of truth
2. `packages/*/package.json` — `"version"` field must exactly match `VERSION`
3. `CHANGELOG.md` — add entry at the top following Keep a Changelog format
4. Root `package.json` (if present) — must match `VERSION`

## Changelog Format

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- (new features)

### Changed
- (changes to existing functionality)

### Fixed
- (bug fixes)

### Security
- (security fixes — always include CVE or report reference if applicable)
```

## Version Drift Prevention

Before any release commit:
1. Run: `grep -r '"version"' packages/*/package.json` — all must match `VERSION`
2. Check `CHANGELOG.md` has an entry for this version
3. The PM agent enforces this check as a pre-release gate

## Pre-release Versioning

For pre-release builds: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, `X.Y.Z-rc.N`

Pre-release packages MUST NOT be published to npm registries as stable.

## Scope of "This Package" in changelogs

The changelog is monorepo-wide. When a change affects only one package, prefix the entry:
- `[server-node]` — affects `rvfs/rvfs-server-node` only
- `[client-node]` — affects `rvfs/rvfs-client-node` only
- `[types]` — affects `rvfs/rvfs-types` only
- (no prefix) — affects all packages or a cross-cutting concern
