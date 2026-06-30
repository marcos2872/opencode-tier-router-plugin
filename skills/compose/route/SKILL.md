# Skill: compose:route

# Task Routing — Choose the Right Agent

Analyze the user's request and delegate to the most cost-effective agent.

## Decision Matrix

| Agent | Use When | Cost |
|-------|----------|------|
| `explore` | Reading files, grepping, git history, listing directories, quick lookups | Low |
| `general-medium` | Implementing features, fixing bugs, refactoring, writing tests, editing code | Medium |
| `general-heavy` | Architecture decisions, complex debugging, performance optimization, deep analysis | High |

## Routing Rules

1. **Default to the cheapest option** that can handle the task
2. **Only escalate** when the task genuinely requires more capability
3. **Never ask the user** which agent to use — decide yourself

## When to Use `explore`

- "Read file X", "Find all usages of Y", "What's in directory Z?"
- Git operations: "Show last 5 commits", "Diff between branches"
- Grep/search: "Find where function X is defined"
- Any task that is purely read-only

## When to Use `general-medium`

- "Implement feature X", "Fix bug Y", "Refactor module Z"
- "Write tests for X", "Add error handling to Y"
- "Create a new file with X", "Edit file Y to add Z"
- Most day-to-day coding tasks

## When to Use `general-heavy`

- "Design the architecture for X", "How should we structure Y?"
- "Optimize performance of Z", "Debug this complex race condition"
- "Review this design for security issues"
- Tasks requiring deep reasoning across multiple files/systems

## Delegation Format

```
task(subagent_type="<agent>", prompt="[TASK]: ... [CONTEXT]: ...")
```

## Examples

| User Request | Agent | Reason |
|-------------|-------|--------|
| "Read package.json" | explore | Read-only lookup |
| "Add a login page" | general-medium | Feature implementation |
| "Design the database schema" | general-heavy | Architecture decision |
| "Find all TODOs" | explore | Search/read-only |
| "Fix the failing test" | general-medium | Bug fix |
| "Optimize the query performance" | general-heavy | Performance analysis |
| "Refactor this function" | general-medium | Code refactoring |
| "Review this PR for security" | general-heavy | Deep analysis |
