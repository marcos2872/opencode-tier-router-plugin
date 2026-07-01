---
name: compose:route
hidden: true
description: Use when delegating any task to a subagent — chooses the most cost-effective agent for the job
---

# Task Routing — Choose the Right Agent

<HARD-GATE>
You NEVER read files, grep, or edit code directly. Every operation is delegated to a subagent via `actor`. Use `actor` with the right `subagent_type` and `model` instead.
</HARD-GATE>

**Core principle:** Always use the cheapest agent that can handle the task.

## Available Agents

| subagent_type | Use For |
|---------------|---------|
| `explore` | Read-only: reading, grepping, git, listing |
| `general` | Everything else: implement, fix, refactor, review, debug |

## Model Tiers (from tiers.json)

The `general` agent supports two model tiers. Select via the `model` parameter in `actor`:

| Tier | Model | Use For |
|------|-------|---------|
| `general-medium` | llama.cpp/Nex-N2-mini | Build, fix, refactor, write tests, create/edit files |
| `general-heavy` | opencode/big-pickle | Architecture, plans, specs, deep debug, security review |

## Decision Matrix

| Operation | subagent_type | model | Reason |
|-----------|---------------|-------|--------|
| Read file | `explore` | — | Read-only, no judgment needed |
| Find usages / grep | `explore` | — | Read-only search |
| List directory / git log | `explore` | — | Read-only lookup |
| Diff between branches | `explore` | — | Read-only |
| Implement feature | `general` | `general-medium` | Code writing |
| Fix bug | `general` | `general-medium` | Code editing |
| Refactor code | `general` | `general-medium` | Code editing |
| Write tests | `general` | `general-medium` | Code writing |
| Create/edit file | `general` | `general-medium` | File writing |
| Run commands + fix | `general` | `general-medium` | Bash + edit |
| Validate/review code | `general` | `general-heavy` | Requires judgment and analysis |
| Fact-check claims against code | `general` | `general-heavy` | Requires reasoning, not just reading |
| Analyze code quality | `general` | `general-heavy` | Requires comparison and evaluation |
| Design architecture | `general` | `general-heavy` | Deep reasoning |
| Complex debugging | `general` | `general-heavy` | Multi-file analysis |
| Security review | `general` | `general-heavy` | Deep analysis |
| Write specs/plans | `general` | `general-heavy` | Design judgment |

## Key Rule: explore vs general

**explore** = read data, return raw results. No analysis, no judgment, no opinion.

**general** = anything that requires thinking about what was read. If the task asks "is this correct?", "what's wrong?", "validate", "review", "analyze", "fact-check" — it's general, not explore.

## How to Dispatch

```
actor(
  operation: {
    action: "run",
    subagent_type: "explore" | "general",
    model: "general-medium" | "general-heavy",  // only for general
    description: "short description",
    prompt: "[TASK]: ...\n[CONTEXT]: ...\n[CONSTRAINTS]: ...\n[OUTPUT]: ..."
  }
)
```

### Examples

**Read a file (explore, no model override needed):**
```
actor(operation: { action: "run", subagent_type: "explore",
  description: "Read auth module",
  prompt: "[TASK]: Read src/auth.ts and report the loginUser function.\n[OUTPUT]: Function signature." })
```

**Fix a bug (general-medium — cheap model):**
```
actor(operation: { action: "run", subagent_type: "general", model: "general-medium",
  description: "Fix null check",
  prompt: "[TASK]: Fix null check at src/auth.ts:42.\n[OUTPUT]: Summary of change." })
```

**Architecture review (general-heavy — expensive model):**
```
actor(operation: { action: "run", subagent_type: "general", model: "general-heavy",
  description: "Review auth architecture",
  prompt: "[TASK]: Review auth architecture across src/.\n[OUTPUT]: Findings with recommendations." })
```

## Quick Reference

| User says | subagent_type | model |
|-----------|---------------|-------|
| "Read X" | explore | — |
| "Find all Y" | explore | — |
| "Fix X" | general | general-medium |
| "Implement X" | general | general-medium |
| "Write tests" | general | general-medium |
| "Validate X" | general | general-heavy |
| "Review X" | general | general-heavy |
| "Fact-check X" | general | general-heavy |
| "Analyze X" | general | general-heavy |
| "Design architecture" | general | general-heavy |
| "Write spec/plan" | general | general-heavy |
| "Debug complex issue" | general | general-heavy |
| "Review for security" | general | general-heavy |
