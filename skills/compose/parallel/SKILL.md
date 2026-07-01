---
name: compose:parallel
hidden: true
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Parallel — Dispatch Independent Tasks

## When

- 2+ tasks with no shared state
- Each task understood independently
- Tasks don't edit same files

## Pattern

1. Route each task (pick agent + model)
2. Dispatch ALL in one message
3. Review results

## Example

```
actor({ operation: { action: "run", subagent_type: "explore", description: "Read A", prompt: "[TASK]: Read src/a.ts\n[OUTPUT]: Content." } })
actor({ operation: { action: "run", subagent_type: "general", model: "general-medium", description: "Fix B", prompt: "[TASK]: Fix src/b.ts:10\n[OUTPUT]: Summary." } })
actor({ operation: { action: "run", subagent_type: "general", model: "general-heavy", description: "Review C", prompt: "[TASK]: Review src/c.ts\n[OUTPUT]: Findings." } })
```
