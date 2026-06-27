# AGENTS.md — opencode-tier-router-plugin

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
opencode-tier-router-plugin/
├── tiers.json                 # Single config: tiers, modes, taskPatterns, enforcement, routing
├── src/
│   ├── index.ts               # Plugin entry: all hooks wired (config, chat.message, chat.system.transform, tool.execute.after, command.execute.before)
│   ├── plugin-orchestrator.ts # Hook orchestration (SRP extraction)
│   ├── constants.ts           # Named constants (FALLBACK_CONFIG, regex)
│   ├── narration.ts           # Narration pattern detection
│   ├── utils/
│   │   └── safe-json.ts       # Safe JSON parsing with size limit
│   └── router/
│       ├── config.ts          # Load/validate tiers.json, layered resolution
│       ├── protocol.ts        # ~210 token delegation protocol generator
│       ├── classifier.ts      # Keyword → tier classification
│       ├── selector.ts        # keyword/llm routing selector + fallback chain
│       ├── caps.ts            # Cap tracker + redundancy detection
│       ├── enforcement-validator.ts    # Enforcement validation (validateEnforcement, assertEnforcement, reportEnforcement)
├── ENFORCEMENT.md             # Enforcement rules, architecture guarantees, security checklist
└── test/                      # Unit tests by area
    ├── phase0-modules.spec.ts          # SRP module tests
    ├── enforcement-validator.spec.ts   # validation, assertion, reporting
    ├── phase2-persistence.spec.ts      # load/save + session management
    ├── phase4-e2e.spec.ts              # full session lifecycle
    ├── phase5-plugin-integration.spec.ts   # plugin hooks + real usage
    ├── caps.test.ts                    # Cap tracker unit tests
    ├── cleanup-versioning.spec.ts      # Cleanup + versioning tests
    ├── config-thresholds.spec.ts       # Config thresholds tests
    ├── index.test.ts                   # Index integration tests
    ├── lru-eviction.spec.ts            # LRU eviction tests
    └── race-conditions.spec.ts         # Concurrent access tests
```

## Architecture decisions (STATE.md AD-001–005)

- Plugin, not standalone agent or proxy
- Single `tiers.json`, no separate state file, no provider presets
- Routing via system prompt injection (~210 tokens), not a router model
- Enforcement defaults to hard-block (`trivialDirectAllowed=false`), advisory available via config
- Routing strategy: `llm` selector with fallback (`llm -> keyword -> defaultTier`), `keyword` also available
- Config resolution: project `tiers.json` > `~/.config/opencode/tiers.json` > create in project dir

## Commands

```bash
# Build (outputs dist/index.js from src/index.ts)
npm run build

# Typecheck src + tests
npm run typecheck

# Run unit tests
npx vitest run

# Lint + format
npm run lint
npm run format

# Full gate (typecheck + test)
npm run typecheck && npx vitest run

# Activate the TLC skill
# (loaded by name — do not resolve by filesystem path)
```

## Reference

- OpenCode plugin API: `@opencode-ai/plugin` — hooks: `config`, `chat.message`, `chat.system.transform`, `permission.ask`, `tool.execute.before/after`, `experimental.text.complete`, `command.execute.before`
- Key hook order used by plugin: `config → chat.message → chat.system.transform → permission.ask → tool.execute.after → command.execute.before`
- Every hook wrapped in `try/catch` with `// best-effort: never crash a real session`
