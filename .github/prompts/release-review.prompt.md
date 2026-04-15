---
description: "Use for a full pre-release quality review spanning spec compliance, coverage, security, and versioning."
---

# RVFS Release Review

Run a complete pre-release quality gate for version $VERSION.

## Checklist

The PM must confirm each section passes before bumping version.

### 1. Versioning Gate

- [ ] Root `VERSION` file contains `$VERSION`
- [ ] All `packages/*/package.json` have `"version": "$VERSION"`
- [ ] `CHANGELOG.md` has an entry for `$VERSION`

Run verification:
```
grep -r '"version"' packages/*/package.json
cat VERSION
```

### 2. Spec Compliance Review (`@reviewer`)

Invoke `@reviewer` with: "Review all packages for spec compliance against sections
§3–14. Flag any requirement from those sections that is not implemented or incorrectly
implemented. Produce a compliance matrix."

### 3. Security Review (`@security`)

Invoke `@security` with: "Run a full security review of all auth, session, permission,
blob integrity, path handling, and rate-limiting code across packages/rvfs-server-node
and packages/rvfs-client-node. Use the full §14 security checklist."

### 4. Test Coverage (`@qa`)

Invoke `@qa` with: "Run the full test suite and report coverage per package. Flag any
spec-required behaviour (§3–14) that has no test. Report pass/fail status."

Pass threshold: 80% per package, 0 failing tests.

### 5. V2 Stub Audit

Confirm all V2 features return `501` with correct body:
- `POST /lock` → 501
- `DELETE /lock/:id` → 501
- `GET /fs/:fsid/locks` → 501
- `POST /presign` → 501
- `GET /presigned/:token` → 501
- Fork depth > 1 → 400 FORK_DEPTH_EXCEEDED

### 6. DX & Documentation Review (`@dx`, `@docs`)

- [ ] All public API methods have JSDoc
- [ ] Root README is up to date
- [ ] Each package has a README with quick-start example
- [ ] V2-deferred features are clearly marked

### 7. Final Decision

| Gate | Result | Agent |
|------|--------|-------|
| Versioning | PASS/FAIL | PM |
| Spec compliance | PASS/FAIL | @reviewer |
| Security | PASS/FAIL | @security |
| Tests | PASS/FAIL | @qa |
| V2 stubs | PASS/FAIL | PM |
| Docs | PASS/FAIL | @docs |

**Release decision:** PROCEED | BLOCK (list blockers)
