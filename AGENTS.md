# AGENTS.md — opencode-tier-router

## First rule

**Follow `.specs/`.** Spec is source of truth. Read `STATE.md` Decisions before any design work. Read the feature's `spec.md`, `tasks.md`, and `context.md` before any implementation. Update `STATE.md` Handoff when pausing.

## Workflow

This project uses `tlc-spec-driven` skill (`.agents/skills/tlc-spec-driven/`).

```
.specs/
├── STATE.md                       # Decisions + Handoff
└── features/[feature]/
    ├── spec.md                    # Requirements + ACs in WHEN/THEN/SHALL
    ├── context.md                 # Implementation decisions (when discuss was triggered)
    ├── design.md                  # Architecture (Large/Complex only)
    ├── tasks.md                   # Atomic tasks with dependencies
    └── validation.md              # Verifier report (auto-generated)
```

1. **Specify** → read STATE.md Decisions + confirmed lessons → write `spec.md`
2. **Design** (skip for Medium) → write `design.md`
3. **Tasks** (skip for ≤3 steps) → write `tasks.md`
4. **Execute** → one task at a time, tests co-located, one commit per task
5. **Verifier** runs automatically after last task (author ≠ verifier)

## Project structure

```
opencode-tier-router/
├── tiers.json                 # Single config: tiers, modes, taskPatterns
├── src/
│   ├── index.ts               # Plugin entry: all hooks wired
│   └── router/
│       ├── config.ts          # Load/validate tiers.json, layered resolution
│       ├── protocol.ts        # ~210 token delegation protocol
│       ├── classifier.ts      # Keyword → tier classification
│       └── caps.ts            # Cap tracker + redundancy detection
├── narration.ts               # Narration pattern detection
└── test/                      # Unit tests per module
```

## Architecture decisions (STATE.md AD-001–005)

- Plugin, not standalone agent or proxy
- Single `tiers.json`, no separate state file, no provider presets
- Routing via system prompt injection (~210 tokens), not a router model
- Enforcement advisory-only (banners), never hard-block
- Config resolution: project `tiers.json` > `~/.config/opencode/tiers.json` > create in project dir

## Commands

```bash
# Build + typecheck
npx tsc --noEmit

# Run unit tests
npx vitest run

# Full gate (build + test)
npx tsc --noEmit && npx vitest run

# Activate the TLC skill
# (loaded by name — do not resolve by filesystem path)
```

## Reference

- OpenCode plugin API: `@opencode-ai/plugin` — hooks: `config`, `chat.system.transform`, `tool.execute.before/after`, `experimental.text.complete`, `command.execute.before`
- Key hook order: `config → chat.message → chat.system.transform → chat.params`
- Every hook wrapped in `try/catch` with `// best-effort: never crash a real session`
