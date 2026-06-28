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
│   ├── index.ts               # Plugin entry: all hooks wired
│   ├── plugin-orchestrator.ts # Hook orchestration (SRP extraction)
│   ├── prompts.ts             # Prompt builders (delegation protocol, hard-block, routing hint)
│   ├── constants.ts           # Named constants (FALLBACK_CONFIG, regex, SESSION_TTL)
│   ├── narration.ts           # Narration pattern detection
│   ├── utils/
│   │   ├── logger.ts          # FileLogger — logs to router-debug.log in plugin dir
│   │   └── safe-json.ts       # Safe JSON parsing with size limit
│   └── router/
│       ├── config.ts          # Load/validate tiers.json, layered resolution
│       ├── protocol.ts        # Task classification protocol
│       ├── classifier.ts      # Keyword → tier classification
│       ├── selector.ts        # keyword/llm routing selector + fallback chain
│       ├── caps.ts            # Cap tracker + redundancy detection
│       └── enforcement-validator.ts    # Enforcement validation
├── ENFORCEMENT.md             # Enforcement rules, architecture guarantees, security checklist
└── test/                      # Unit tests by area
    ├── phase0-modules.spec.ts
    ├── enforcement-validator.spec.ts
    ├── phase2-persistence.spec.ts
    ├── phase4-e2e.spec.ts
    ├── phase5-plugin-integration.spec.ts
    ├── protocol.test.ts
    ├── caps.test.ts
    ├── cleanup-versioning.spec.ts
    ├── config-thresholds.spec.ts
    ├── index.test.ts
    ├── lru-eviction.spec.ts
    └── race-conditions.spec.ts
```

## Architecture decisions

- Plugin, not standalone agent or proxy
- Single `tiers.json`, no separate state file, no provider presets
- Routing via system prompt injection (~210 tokens), not a router model
- Enforcement defaults to hard-block (`trivialDirectAllowed=false`), advisory available via config
- Routing strategy: `llm` selector with fallback (`llm -> keyword -> defaultTier`), `keyword` also available
- Config resolution: project `tiers.json` > `~/.config/opencode/tiers.json` > create in project dir
- `buildDelegationProtocol` is purely informational (tiers, costs, rules) — safe for all sessions
- `buildHardBlockMessage` carries strong delegation instructions — only injected for hard-blocked main sessions
- Subagents receive only the informational protocol; they cannot delegate to other subagents
- Permission blocking uses `permission.ask` (deny for hard-blocked, allow for subagents) + event hook (reject for hard-blocked, auto-allow once for others)
- Logs go to `{plugin_dir}/router-debug.log` via FileLogger, never to terminal

## Hook order

```
config → chat.message → experimental.chat.system.transform → permission.ask
  → event → tool.definition → tool.execute.after → experimental.text.complete
  → command.execute.before
```

Every hook wrapped in `try/catch` with `// best-effort: never crash a real session`.

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

- OpenCode plugin API: `@opencode-ai/plugin`
- Key hooks: `config`, `chat.message`, `experimental.chat.system.transform`, `permission.ask`, `event`, `tool.definition`, `tool.execute.after`, `experimental.text.complete`, `command.execute.before`
- FileLogger: `src/utils/logger.ts` — writes to `{plugin_dir}/router-debug.log`
