---
name: compose:route
hidden: true
description: Use when delegating any task to a subagent — chooses the most cost-effective agent for the job
---

# Route — Pick Agent + Model

## Decision table

| Operation | subagent_type | model |
|-----------|---------------|-------|
| Read file | explore | — |
| Grep / find usages | explore | — |
| Git log / diff | explore | — |
| List directory | explore | — |
| Fix bug | general | general-medium |
| Refactor | general | general-medium |
| Write tests | general | general-medium |
| Create / edit file | general | general-medium |
| Run commands + fix | general | general-medium |
| Validate code | general | general-heavy |
| Review / fact-check | general | general-heavy |
| Analyze quality | general | general-heavy |
| Design architecture | general | general-heavy |
| Write specs / plans | general | general-heavy |
| Complex debugging | general | general-heavy |
| Security review | general | general-heavy |

## Rule

**explore** = return raw data. No analysis.
**general** = anything requiring thinking. "Is this correct?" = general, not explore.

## Dispatch examples

```
actor({ operation: { action: "run", subagent_type: "explore", description: "Read file", prompt: "[TASK]: Read src/auth.ts\n[OUTPUT]: Full content." } })
```

```
actor({ operation: { action: "run", subagent_type: "general", model: "general-medium", description: "Fix bug", prompt: "[TASK]: Fix null check at src/auth.ts:42\n[OUTPUT]: Summary." } })
```

```
actor({ operation: { action: "run", subagent_type: "general", model: "general-heavy", description: "Validate", prompt: "[TASK]: Verify each claim in report\n[OUTPUT]: TRUE/FALSE with evidence." } })
```
