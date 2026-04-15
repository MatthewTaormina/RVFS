---
description: "Use when the PM or Planner needs to create a structured implementation plan for a spec section or feature."
---

# RVFS Implementation Plan

Create a detailed, ordered implementation plan for a feature or spec section.

## Target

**Feature / Spec sections:** $FEATURE_OR_SECTIONS

**Target package(s):** $PACKAGES

**Phase:** V1 | V2

## Instructions

1. Read `.specs/vfs-remote.md` sections: $FEATURE_OR_SECTIONS
2. Read existing code in $PACKAGES to understand current state.
3. Produce the following:

### 1. Requirement Summary
List every spec requirement from the target sections with their exact §references.
Mark each as: ✓ Already implemented | ⚠ Partial | ✗ Not started

### 2. Dependency Graph
Identify what must come before each task. Format:
```
Task A → (required by) → Task B, Task C
Task B → (required by) → Task D
```

### 3. Ordered Task List

For each task:
```markdown
#### Task N: [Short Name]

- **Spec refs:** §X.Y, §X.Z
- **Package:** [package name]
- **Delegate to:** @[agent-name]
- **Depends on:** Task #, Task #
- **Effort:** S (< 1 hour) | M (half day) | L (full day)
- **Risk:** Low | Medium | High

**Files to create/modify:**
- `src/[path]` — [description]
- `tests/[path]` — [test cases]

**Acceptance criteria:**
- [ ] [specific behaviour]
- [ ] [error case]
- [ ] [spec compliance check]
```

### 4. V2 Stubs Required
List any V2 features that need a 501 stub as part of this feature's scope.

### 5. Security Review Items
List anything in this plan that needs `@security` sign-off before shipping.

### 6. Suggested Sprint Breakdown
If there are > 5 tasks, suggest how to group them into 2-3 sequential work sessions.
