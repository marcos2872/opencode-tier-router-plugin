---
name: compose:code-conventions
hidden: true
description: "Use when reviewing code quality, architecture, design patterns, or applying SOLID/Clean Code/DDD principles. Routes review tasks to general agent automatically."
---

Before dispatching any subagent, load compose:route first.

# Code Quality Review

## Routing

This skill handles code review, architecture analysis, and design evaluation.

**CRITICAL:** These tasks require `general` agent with `general-heavy` model. They are NOT read-only operations.

| Task | subagent_type | model |
|------|---------------|-------|
| Code review | general | general-heavy |
| Architecture analysis | general | general-heavy |
| Design evaluation | general | general-heavy |
| Quality audit | general | general-heavy |
| Pattern compliance | general | general-heavy |

## Dispatch Examples

```
actor({ operation: { action: "run", subagent_type: "general", model: "general-heavy", description: "Code review", prompt: "[TASK]: Review code quality\n[OUTPUT]: Issues with file:line references." } })
```

```
actor({ operation: { action: "run", subagent_type: "general", model: "general-heavy", description: "Architecture review", prompt: "[TASK]: Analyze architecture\n[OUTPUT]: Design issues and recommendations." } })
```

## Principles

- **SOLID** — Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **Clean Code** — Meaningful names, small functions, no hidden side effects, comment the why not the what
- **Clean Architecture** — Dependencies point inward, separate domain/infrastructure, testable without I/O
- **DDD** — Ubiquitous language, aggregates as consistency boundaries, rich domain models

## Evaluation Criteria

| Level | Meaning |
|-------|---------|
| **ERROR** | Violates principles with functional risk |
| **WARNING** | Violates principles without immediate risk (technical debt) |
| **SUGESTÃO** | Could be clearer, more cohesive, or more consistent |
