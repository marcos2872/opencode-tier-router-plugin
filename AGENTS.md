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
├── tiers.json                 # Single config: tiers, modes, router agent defaults
├── src/
│   ├── index.ts               # Plugin entry: config-only hook
│   └── config.ts              # load/validate tiers.json + create Router/subagents
└── test/                      # Unit tests by area
    ├── config.spec.ts
    └── index.test.ts
```

## Architecture decisions

- Plugin is config-only: it only registers the `config` hook.
- The Router agent is configured in `tiers.json` (`agentName`, `agentModel`, `routerPrompt`) and has `task` allowed with all native execution tools denied.
- `@fast`, `@medium`, and `@heavy` subagents are configured as `mode: subagent` with tools allowed and their own `systemPrompt`.
- Routing is delegated to the Router LLM via `routerPrompt`; there is no local classifier, selector, protocol, cap tracker, hard-block hook, or tool redirect.
- `taskPatterns`, `enforcement`, and `routing` are ignored for compatibility and removed from the checked-in `tiers.json`.
- Subagent `systemPrompt` values are read from `tiers.json.tiers.<tier>.systemPrompt` with embedded fallback prompts.
- Runtime prompt hooks are not used by this plugin: `experimental.chat.system.transform`, `experimental.text.complete`, and `command.execute.before` are absent.
- The plugin catches config errors and logs `[tier-router] config error` without crashing the host session.

## Hook order

```
config
```

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
- Key hook: `config`
- Config resolver: `src/config.ts`
- Router default config: `tiers.json`
