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
├── tiers.json                 # Single config: tiers, modes, taskPatterns, enforcement, routing, tokenTracking
├── src/
│   ├── index.ts               # Plugin entry: all hooks wired (config, chat.message, chat.system.transform, tool.execute.after, command.execute.before)
│   └── router/
│       ├── config.ts          # Load/validate tiers.json, layered resolution
│       ├── protocol.ts        # ~210 token delegation protocol generator
│       ├── classifier.ts      # Keyword → tier classification
│       ├── selector.ts        # keyword/llm routing selector + fallback chain
│       ├── caps.ts            # Cap tracker + redundancy detection
│       ├── enforcement-validator.ts    # Enforcement validation (validateEnforcement, assertEnforcement, reportEnforcement)
│       ├── token-tracker.ts   # Real Token Cost Tracking API (recordStepFinish, getSummary, persistTokenMetrics)
│       ├── token-commands.ts  # Command execution layer (/token-report, /token-history, /token-compare)
│       ├── token-event-parser.ts       # Event extraction & parsing (TokenEventParser, DefaultTokenEventParser)
│       ├── metrics-aggregator.ts       # Session aggregation & tier accuracy calculation
│       ├── metrics-storage.ts          # Storage interface (adapter pattern)
│       ├── filesystem-storage.ts       # Disk persistence (JSON + LRU + TTL + FIFO cleanup)
│       ├── in-memory-storage.ts        # Memory cache
│       ├── metrics-formatter.ts        # Markdown report generation
│       └── orphan-buffer.ts   # Event correlation (5s retry, FIFO matching)
├── narration.ts               # Narration pattern detection
├── ENFORCEMENT.md             # Enforcement rules, architecture guarantees, security checklist
└── test/                      # Unit tests per phase (300 tests total)
    ├── phase0-modules.spec.ts          # 163 tests: 5 SRP modules + OrphanBuffer
    ├── enforcement-validator.spec.ts   # 37 tests: validation, assertion, reporting
    ├── phase1-real-token-tracking.spec.ts  # 24 tests: event recording + routing correlation
    ├── phase2-persistence.spec.ts      # 16 tests: load/save + session management
    ├── phase3-commands.spec.ts         # 25 tests: /token-* commands + detection
    ├── phase4-e2e.spec.ts              # 20 tests: full session lifecycle
    └── phase5-plugin-integration.spec.ts   # 15 tests: plugin hooks + real usage
```

## Architecture decisions (STATE.md AD-001–005)

- Plugin, not standalone agent or proxy
- Single `tiers.json`, no separate state file, no provider presets
- Routing via system prompt injection (~210 tokens), not a router model
- Enforcement defaults to hard-block (`trivialDirectAllowed=false`), advisory available via config
- Routing strategy defaults to `keyword`, optional `llm` selector with fallback (`llm -> keyword -> defaultTier`)
- Config resolution: project `tiers.json` > `~/.config/opencode/tiers.json` > create in project dir

## Token Tracking & Real Cost Analysis (STATE.md AD-006–010)

- **Real event capture** (AD-006): `tool.execute.after` hook captures actual token usage; not heuristic estimates
- **100% delegation enforcement** (AD-007): `enforcement.mode=hard-block` + `trivialDirectAllowed=false` blocks ANY direct execution; all tasks route through tier selector
- **Event correlation** (AD-008): `orphan-buffer.ts` handles race conditions; `recordStepFinish()` + `recordRoutingDecision()` provide public API
- **Persistence model** (AD-009): SessionCache (100 LRU, 30min TTL) evicts to disk; `PersistedTokenSession v1.0` enables schema evolution
- **Best-effort API** (AD-010): All public methods async, catch errors, log warnings, return null/undefined gracefully — never throw to plugin


## Commands

```bash
# Build (outputs dist/index.js from src/index.ts)
npm run build

# Typecheck src + tests
npm run typecheck

# Run unit tests
npx vitest run

# Full gate (typecheck + test)
npm run typecheck && npx vitest run

# Activate the TLC skill
# (loaded by name — do not resolve by filesystem path)
```

## Reference

- OpenCode plugin API: `@opencode-ai/plugin` — hooks: `config`, `chat.message`, `chat.system.transform`, `permission.ask`, `tool.execute.before/after`, `experimental.text.complete`, `command.execute.before`
- Key hook order used by plugin: `config → chat.message → chat.system.transform → permission.ask → tool.execute.after → command.execute.before`
- Every hook wrapped in `try/catch` with `// best-effort: never crash a real session`

## Token Tracking Hooks & API

### `tool.execute.after` Hook Flow

1. **Capture**: Hook intercepts `{ tool, input, output, ok }`
2. **Parse**: DefaultTokenEventParser extracts `{ inputTokens, outputTokens, cacheTokens, reasoningTokens }`
3. **Estimate cost**: multiply tokens by tier's cost ratio
4. **Record**: `recordStepFinish(tokens, cost)` adds to SessionCache
5. **Correlate**: if preferred tier known, `recordRoutingDecision(tier)` links to routing

### TokenTracker Public API

```typescript
// Record token usage from a tool step
recordStepFinish(sessionId: string, tokens: TokenRecord): Promise<void>

// Record routing decision (for accuracy calculation)
recordRoutingDecision(sessionId: string, tier: string): Promise<void>

// Get current session summary (memory or disk)
getSummary(sessionId: string): Promise<SessionMetrics | null>

// Persist session to disk (explicit save)
persistTokenMetrics(sessionId: string): Promise<boolean>

// Load previously persisted session
loadPersistedTokenMetrics(sessionId: string): Promise<PersistedTokenSession | null>

// List all sessions (memory + disk)
getHistory(): Promise<SessionMetrics[]>

// Get detailed session report
getSessionReport(sessionId: string): Promise<string>

// Compare actual vs. hypothetical costs
getComparison(sessionId: string): Promise<string>
```

### Event Format

```typescript
interface TokenRecord {
  inputTokens: number
  outputTokens: number
  cacheTokens?: number
  reasoningTokens?: number
  tier?: string  // @fast, @medium, @heavy
  toolName?: string
  timestamp?: number
}
```

### Session Persistence (v1.0)

Formato JSON em disco:
```json
{
  "version": "1.0",
  "sessionId": "abc123-def456",
  "createdAt": "2026-06-27T10:00:00Z",
  "records": [...],
  "routingDecisions": [...],
  "tierAccuracy": 0.85
}
```
