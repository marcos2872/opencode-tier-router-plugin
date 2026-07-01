---
name: compose:parallel
hidden: true
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Parallel Dispatch — Run Independent Tasks Concurrently

You delegate multiple independent tasks to subagents, all running at the same time. Each agent gets isolated context and a focused scope. You never do the work yourself — you orchestrate.

**Core principle:** One agent per independent domain. Let them work concurrently.

## When to Use

**Use when:**
- 2+ tasks that are independent (no shared state, no dependencies)
- Each task can be understood without context from others
- Tasks don't edit the same files

**Don't use when:**
- Tasks are related (fixing one might fix others)
- Need to understand full system state first
- Tasks share files or resources

## The Pattern

### 1. Identify Independent Domains

Group tasks by what they touch:
- Task A: src/auth/login.ts
- Task B: src/api/routes.ts
- Task C: src/tests/auth.test.ts

### 2. Route Each Task

Use `compose:route` to pick the agent and model tier:
- Read-only → `explore` (no model needed)
- Build/fix/refactor → `general` with `model: "general-medium"`
- Architecture/plans/specs → `general` with `model: "general-heavy"`

### 3. Dispatch All at Once

Send all agent calls in the **same message**:

```
actor(subagent_type="explore", prompt="Read src/auth/login.ts and report the loginUser function")
actor(subagent_type="general", model="general-medium", prompt="Fix the timeout in src/auth/login.ts:42")
actor(subagent_type="general", model="general-medium", prompt="Write tests for src/auth/login.ts")
```

### 4. Review and Integrate

When agents return:
1. Read each summary
2. Check for conflicts
3. Verify each change
4. Run full test suite

## Prompt Structure

Every prompt MUST have: `[TASK]`, `[CONTEXT]`, `[CONSTRAINTS]`, `[OUTPUT]`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| "Fix all tests" (too broad) | Split into per-file tasks |
| No context | Paste file contents, errors |
| Dispatching sequentially | Send all calls in ONE message |
| Agents editing same file | Split by file, or run sequentially |
| Wrong model tier | Use general-medium for build, general-heavy for architecture |
