# AGENTS.md

## What this is

OpenCode plugin: Compose orchestration + BM25 memory + tier-based model routing.

## Commands

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit (no build output)
```

No test suite. No linter. No formatter config. `build` and `typecheck` are the only verification steps.

## Architecture

```
src/index.ts       → Plugin entry: config hook + memory tool
src/config.ts      → Creates agents, loads tiers.json, injects models into markdown
src/memory/        → SQLite FTS5 memory (store, tool, reconcile)
agents/*.md        → Agent definitions (markdown frontmatter + optional prompt)
skills/compose/    → 17 compose skills (route, brainstorm, plan, tdd, etc.)
prompts/*.txt      → System prompts for compose and checkpoint-writer
tiers.json         → Model config per tier (compose, explore, general-medium, general-heavy)
```

## Key behavior

- Plugin reads `tiers.json` from project root or `~/.config/opencode/tiers.json`
- Models are injected into agent markdown frontmatter at config time via `injectModelIntoFrontmatter()`
- Agent paths use `<cwd>/.opencode/agents/` (not `agents/`)
- `compose.md` has `prompt: { file: "prompts/compose-system.txt" }` — both are symlinks in target projects

## Agent routing

The compose dispatches subagents by name. Each agent has its own model built-in.

| Agent | Use for |
|-------|---------|
| `explore` | Read, grep, search, git — fast, read-only |
| `general` | Fix, refactor, test, create files |
| `general-heavy` | Review, architecture, design, complex debug |

The compose does NOT pass a `model` parameter to actor calls. Routing is by agent name only.

## tiers.json format

```json
{
  "compose": { "model": "..." },
  "explore": { "model": "..." },
  "general-medium": { "model": "..." },
  "general-heavy": { "model": "..." }
}
```

All keys optional. Defaults: compose=mimo-v2.5-free, explore=big-pickle, general-medium=mimo-v2.5-free, general-heavy=big-pickle.

## Target project setup

Agents, prompts, and skills in `.opencode/` are **symlinks** back to this plugin's files. When editing agent definitions or skills, edit the source here — the symlinks follow automatically.

## Gotchas

- `process.cwd()` vs `input.directory`: plugin uses `input.directory` for agent paths, not cwd
- `general-heavy.md` has `model: ""` in source — filled at runtime by the plugin
- No `compose` agent in the `general` sense — `compose` is primary mode, never dispatched as subagent
- `dream` and `checkpoint-writer` are hidden agents, not listed in compose's dispatch table
