---
name: compose:code-conventions
hidden: true
description: "Use when reviewing code quality, architecture, design patterns, or applying SOLID/Clean Code/DDD principles. Routes review tasks to general-heavy agent automatically."
---

# Code Quality Review

## Routing

This skill handles code review, architecture analysis, and design evaluation.

**Use `general-heavy` agent for all tasks in this skill.**

| Task | subagent_type |
|------|---------------|
| Code review | general-heavy |
| Architecture analysis | general-heavy |
| Design evaluation | general-heavy |
| Quality audit | general-heavy |
| Pattern compliance | general-heavy |

## Dispatch Examples

```
actor({ operation: { action: "run", subagent_type: "general-heavy", description: "Code review", prompt: "[TASK]: Review code quality\n[OUTPUT]: Issues with file:line references." } })
```

```
actor({ operation: { action: "run", subagent_type: "general-heavy", description: "Architecture review", prompt: "[TASK]: Analyze architecture\n[OUTPUT]: Design issues and recommendations." } })
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
