---
name: compose:route
hidden: true
description: Use when delegating any task to a subagent — chooses the most cost-effective agent for the job
---

# Route — Pick Agent

## Decision table

| Operation | subagent_type |
|-----------|---------------|
| Read file | explore |
| Grep / find usages | explore |
| Git log / diff | explore |
| List directory | explore |
| Fix bug | general |
| Refactor | general |
| Write tests | general |
| Create / edit file | general |
| Run commands + fix | general |
| Validate code | general-heavy |
| Review / fact-check | general-heavy |
| Analyze quality | general-heavy |
| Design architecture | general-heavy |
| Write specs / plans | general-heavy |
| Complex debugging | general-heavy |
| Security review | general-heavy |

## Rule

**explore** = return raw data. No analysis.
**general** = simple implementation tasks.
**general-heavy** = anything requiring thinking, judgment, or recommendations.

## Dispatch examples

```
actor({ operation: { action: "run", subagent_type: "explore", description: "Read file", prompt: "[TASK]: Read src/auth.ts\n[OUTPUT]: Full content." } })
```

```
actor({ operation: { action: "run", subagent_type: "general", description: "Fix bug", prompt: "[TASK]: Fix null check at src/auth.ts:42\n[OUTPUT]: Summary." } })
```

```
actor({ operation: { action: "run", subagent_type: "general-heavy", description: "Validate", prompt: "[TASK]: Verify each claim in report\n[OUTPUT]: TRUE/FALSE with evidence." } })
```
