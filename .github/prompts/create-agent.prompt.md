---
description: "Use when the PM needs to commission a new specialist agent for the RVFS team."
---

# Create New RVFS Agent

Create a new specialist agent for the RVFS monorepo agent team.

## New Agent Specification

**Role name:** $AGENT_ROLE

**Purpose (when to invoke):** $AGENT_PURPOSE

**Tool requirements:**
- Needs to read files: $NEEDS_READ
- Needs to edit/create files: $NEEDS_EDIT
- Needs to search codebase: $NEEDS_SEARCH
- Needs to run terminal commands: $NEEDS_EXECUTE
- Needs to invoke other agents: $NEEDS_AGENT
- Needs to access the web: $NEEDS_WEB

**RVFS spec sections this agent works with:** $SPEC_SECTIONS

**Key domain knowledge it needs:**
$DOMAIN_KNOWLEDGE

**What it MUST NOT do:**
$CONSTRAINTS

**Output format it should produce:**
$OUTPUT_FORMAT

**Should users be able to invoke it directly?** $USER_INVOCABLE

## Instructions for Agent Factory

1. Read `.github/agents/agent-factory.agent.md` for the template and quality checklist.
2. Read existing agent files in `.github/agents/` to avoid duplication.
3. Create the new file at `.github/agents/{kebab-case-name}.agent.md`.
4. After creation, output:
   - The file path created
   - A summary of the new agent's role
   - Which existing agents it coordinates with
   - What trigger phrases invoke it
5. The PM must then:
   - Add the new agent to the Delegation Map in `.github/agents/pm.agent.md`
   - Add the new agent to the Agent Team table in `.github/copilot-instructions.md`
   - Test-invoke the new agent with a simple task
