---
description: "Git workflow, TDD, branching, worktree, and commit conventions. Apply to all agent work in this repo."
applyTo: ".github/agents/**"
---

# RVFS Git Workflow & Development Standards

Every agent in this team operates like an **individual developer** on a real project. These
rules are non-negotiable. They apply to every task, every commit, and every merge.

---

## MCP Tools for Team Coordination

The `rvfs-mcp` server (`.vscode/mcp.json`) provides tools all agents use for coordination.
The DB is stored at `.mcp-data/team.db` (gitignored — local only).

### Every agent should use:

| Tool | When |
|------|------|
| `wbs_update(id, "in-progress")` | As soon as you start a task |
| `wbs_update(id, "blocked", note)` | When you hit a blocker — include what's blocking you |
| `wbs_update(id, "review")` | When your branch is ready for Morgan to merge |
| `wbs_update(id, "done")` | Only Morgan sets this after merge |
| `message_send(from, "Morgan", subject, body)` | Notify PM when ready for review or blocked |
| `message_inbox(agent)` | Check for messages from Morgan or teammates |
| `message_mark_read(ids)` | After reading your inbox |
| `scratchpad_write(agent, content)` | Working notes during a task |
| `scratchpad_append(agent, text)` | Add to your working notes |
| `memory_set(agent, key, value)` | Remember a decision or convention that should persist |

### Avery (QA) additionally uses:
- `message_send` to notify the developer when a failing test branch is ready

### Morgan (PM) additionally uses:
- `wbs_add` to create and assign tasks
- `wbs_list` to monitor team progress
- `message_inbox("Morgan")` at the start of every session to see what's waiting

---

## Identity & Autonomy

You are an individual contributor, not a function call. You:
- Have your own name and working style (see your `## Identity` section).
- Own your branch and worktree for the duration of a task.
- Write a `WORKLOG.md` in your worktree so the PM can understand your state at any time.
- Commit atomically and frequently with meaningful messages.
- Ask the PM for decisions when you hit a blocker — you don't guess at direction.

Multiple people with the same role (e.g., two Server Devs) work simultaneously on different
branches. This is intentional. The PM coordinates, not you.

---

## Branch Naming

```
{your-first-name}/{short-kebab-description}

Examples:
  alex/server-session-routes
  sam/client-lru-cache
  avery/tests-blob-integrity
  morgan/merge-session-routes
```

- Always branch from `develop` (or the branch the PM specifies).
- Never push directly to `main`. Never push directly to `develop` without the PM's say-so.
- Feature branches are deleted after merge.

---

## Worktree Protocol

When starting a non-trivial task, create a worktree so your work is isolated:

```bash
# From repo root — always use .worktrees/ as the base directory
git worktree add .worktrees/alex/server-session-routes alex/server-session-routes
# The branch will be created if it doesn't exist

# To list active worktrees:
git worktree list

# To remove when merged:
git worktree remove .worktrees/alex/server-session-routes
git branch -d alex/server-session-routes
```

**`.worktrees/` is in `.gitignore` — worktrees are never committed, only branches are.**

### WORKLOG.md

Every worktree MUST contain a `WORKLOG.md` at the root of the checked-out branch.
This is the PM's window into your work.

```markdown
# Worklog — {Your Name} / {branch-name}

## Task
[One-paragraph description of what this branch is implementing — spec refs included]

## Status
[In Progress | Blocked | Ready for Review | Merged]

## Progress
- [x] [Completed item with file refs]
- [ ] [Pending item]

## Decisions Made
- [Any non-obvious choice you made and why]

## Blockers
- [What's blocking you, if anything. Tag the agent who can unblock: @architect, @pm, etc.]

## Tests
- [Test files created/modified and what they cover]

## Files Changed
- `src/path/to/file.ts` — [what changed]
```

Update `WORKLOG.md` **before every commit** on your branch.

---

## Commit Message Format (Conventional Commits)

```
<type>(<scope>): <short description>

[optional body — wrap at 72 chars]

[optional footer: BREAKING CHANGE, Closes #issue]
```

### Types

| Type | Use when |
|------|----------|
| `feat` | New feature or spec requirement implemented |
| `fix` | Bug fix |
| `test` | Adding or updating tests (TDD: test commits come BEFORE implementation) |
| `refactor` | Code change that doesn't add features or fix bugs |
| `docs` | Documentation only |
| `chore` | Tooling, config, CI, dependency updates |
| `security` | Security fix (always include a spec §14 reference) |

### Scope = package short name

`server-node`, `client-node`, `types`, `mcp-server`, `ci`, `agents`, `docs`

### Examples

```
feat(server-node): implement POST /session endpoint (§6.4)
test(server-node): add failing tests for blob SHA-256 verification (§14.3)
fix(client-node): invalidate path index on mv() operation
security(server-node): reject path traversal with 400 (§14.4)
chore(ci): add version consistency check to CI pipeline
```

**Test commits use `test:` type and PRECEDE the `feat:` commit they enable (TDD).**

---

## Test-Driven Development (TDD)

TDD is mandatory. The sequence is always:

```
1. QA (or the developer) writes a FAILING test   →  commit: test(scope): add failing test for X
2. Developer writes minimum code to make it pass  →  commit: feat(scope): implement X
3. Developer refactors if needed                  →  commit: refactor(scope): clean up X
4. Repeat
```

### Rules

- **Never commit implementation code before a test exists for it.**
- A `feat:` commit without a corresponding `test:` commit on the same branch is a CI failure.
- Tests live in `tests/` co-located with each package.
- Unit tests must be fast (< 50ms per test) — no real HTTP calls, mock the storage backend.
- Integration tests use `app.inject()`, not a live server.
- Run tests before every commit: `pnpm test`

### Red-Green-Refactor on a Branch

```
git commit -m "test(server-node): failing test for fork depth limit (§14.6)"
# Test fails here — that's correct
pnpm test  # should show 1 failing test
git commit -m "feat(server-node): enforce fork_depth cap in POST /fs/:fsid/fork"
pnpm test  # should be green
```

---

## .gitignore Gate (before every commit)

Before committing, always verify:

```bash
# 1. Check no tracked file would be ignored now
git ls-files --ignored --exclude-standard
# Must return empty. If not: git rm --cached <file>

# 2. Check no secrets or build artifacts are staged
git status
# Verify dist/, node_modules/, .env*, .venv/ are NOT in the staged list

# 3. If .gitignore needs updating (new tool/framework introduced), update it FIRST
# then commit the .gitignore change separately: chore: update .gitignore for X
```

The CI `gitignore-check` job will fail the PR if this is violated.

---

## Python Environment (Phase 2 packages)

Each Python package manages its own isolated virtual environment:

```bash
cd packages/rvfs-server-python      # or rvfs-client-python
python -m venv .venv                 # creates .venv/ — gitignored
source .venv/bin/activate            # Linux/macOS
.venv\Scripts\activate               # Windows

pip install -e ".[dev]"             # install package + dev deps

# Run tests
pytest tests/ --cov
```

**Never `pip install` globally or into a shared environment.**  
**Never commit `.venv/`** — it's in `.gitignore`.

---

## Pull Request Protocol

1. When your branch is ready: update `WORKLOG.md` → Status: `Ready for Review`
2. Notify the PM (Morgan) with: branch name, what it implements, what tests cover it, any blockers.
3. The PM reviews `WORKLOG.md`, runs the CI check summary, and either:
   - Merges to `develop` directly (if clean).
   - Delegates review to `@reviewer` or `@security` before merging.
4. After merge: delete the worktree and branch.

---

## Merge & Conflict Resolution (PM only)

Only Morgan (PM) performs merges. When conflicts arise:

```bash
git merge --no-ff alex/server-session-routes
# On conflict:
git status                    # identify conflicted files
# Resolve using spec as ground truth — spec §X.Y wins over both implementations
git add <resolved-files>
git merge --continue
git commit -m "chore: merge alex/server-session-routes into develop"
```

Conflict resolution rule: **the spec wins**. If two agents implemented the same thing
differently, Morgan reads the spec section, picks the compliant version, and updates
the WORKLOG to document the resolution.

---

## Summary Checklist (every task)

```
[ ] Called wbs_update(task_id, "in-progress") when starting
[ ] Created worktree at .worktrees/{name}/{branch}
[ ] Created WORKLOG.md in the branch
[ ] Wrote failing tests first (test: commit)
[ ] Implemented to make tests pass (feat: commit)
[ ] Verified .gitignore gate before each commit
[ ] Updated WORKLOG.md status to "Ready for Review"
[ ] Called wbs_update(task_id, "review")
[ ] Sent message_send to Morgan with branch summary
```
