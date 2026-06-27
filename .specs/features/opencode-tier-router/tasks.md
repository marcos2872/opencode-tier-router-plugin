# opencode-tier-router Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: (skipped — Medium scope, architecture inline in AD entries on STATE.md)
**Status**: Draft | Approved | In Progress | Done

---

## Test Coverage Matrix

> Generated from project context and strong defaults — no existing repo tests to sample. **Confirm before Execute.**

Project is a new OpenCode plugin. No quality/testing guidelines found in repo. Strong defaults applied (see specify.md reference). User should confirm test framework choice.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| config.ts (load/validate/save) | unit | All branches; error paths for invalid config; save-mode file write | `test/config.test.ts` | `npx vitest run` |
| protocol.ts (protocol builder) | unit | All modes produce correct protocol string; cost ratios injected; task patterns rendered | `test/protocol.test.ts` | `npx vitest run` |
| classifier.ts (task→tier) | unit | Every keyword maps to correct tier; unknown input returns null; case insensitive | `test/classifier.test.ts` | `npx vitest run` |
| caps.ts (tracker+banners) | unit | Counter increments; banners format correctly; redundancy detection by fingerprint; cap banner vs warning vs reached hierarchy | `test/caps.test.ts` | `npx vitest run` |
| narration.ts (detector) | unit | Every NARRATION_PATTERN matches; clean text returns null; partial matches don't trigger | `test/narration.test.ts` | `npx vitest run` |
| index.ts (plugin entry) | none | — (integration-level, needs OpenCode runtime) | — | build gate only |
| tiers.json / package.json / tsconfig.json | none | — (config files) | — | build gate only |

**Provenance note**: Test framework choice (vitest) from reference implementation convention. If user prefers a different framework, update before Execute.

---

## Parallelism Assessment

> Generated from codebase analysis — **Confirm before Execute.**

All unit tests are pure function tests (no shared state, no filesystem, no network). Tests use vitest which defaults to per-file isolation.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | Yes | Per-file isolate; no shared mutable state in any module | All modules are pure functions with injected seams |

---

## Gate Check Commands

> Generated from project build system — **Confirm before Execute.**

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npx vitest run` |
| Build | After phase completion or config-only tasks | `npx tsc --noEmit && npx vitest run` |

---

## Execution Plan

### Phase 1: Foundation (Sequential)

```
T1 → T2
```

### Phase 2: Router (Sequential)

```
T2 → T3 → T4
```

### Phase 3: Enforcement (Parallel OK)

```
         ┌→ T5 [P]
T4 ──────┤
         └→ T6 [P]
```

### Phase 4: Integration (Sequential)

```
T5, T6 → T7
```

---

## Task Breakdown

### T1: Create Project Scaffold

**What**: Initialize the plugin project with package.json, tsconfig.json, and tiers.json config file
**Where**: Project root
**Depends on**: None
**Reuses**: Reference implementation patterns (opencode-model-router)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `package.json` created with `"type": "module"`, `"peerDependencies": { "@opencode-ai/plugin": ">=1.0.0" }`, devDeps `typescript`, `vitest`, `@types/node`
- [x] `tsconfig.json` created with `"module": "preserve"`, `"strict": true`, `"outDir": "dist"`
- [x] `tiers.json` created with three tiers (fast/medium/heavy), four modes (normal/budget/quality/deep), and taskPatterns matching spec.md `taskPatterns`
- [x] `npx tsc --noEmit` passes

**Tests**: none (config files only)
**Gate**: build
**Commit**: `build(opencode-tier-router): scaffold project with package.json, tsconfig, and tiers.json`

---

### T2: Implement Config Module

**What**: Create config.ts with layered config resolution (project tiers.json > global tiers.json), validation, and saveMode() that rewrites tiers.json
**Where**: `src/router/config.ts`
**Depends on**: T1
**Reuses**: Standard JSON parse/validate patterns

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `resolveTiersPath(projectDir, globalDir)` implements resolution: (1) look in `{projectDir}/tiers.json`, (2) if missing, look in `~/.config/opencode/tiers.json`, (3) if both missing, return `{projectDir}/tiers.json` (will be created on first save)
- [x] `loadTiers(projectDir, globalDir)` loads tiers.json from the resolved path, validates shape, returns parsed config
- [x] `saveMode(mode, projectDir)` rewrites `{projectDir}/tiers.json` atomically (write to tmp + rename) — creates the file with default tiers if it doesn't exist yet, updating only the `mode` field
- [x] `getActiveTiers(cfg)` returns the tiers for the current mode (using mode's defaultTier for costRatio lookup)
- [x] `validateConfig()` checks: all tier models present, costRatios positive, taskPatterns non-empty, modes have defaultTier
- [x] Errors never propagate raw — wrapped in `ConfigError` with context
- [x] Gate check passes: `npx vitest run`

**Tests**: unit (coverage: project path overrides global; both missing resolves to project; malformed JSON yields ConfigError; saveMode creates file if absent)
**Gate**: quick
**Commit**: `feat(opencode-tier-router): add config module with layered resolution and mode persistence`

---

### T3: Implement Protocol Builder

**What**: Create protocol.ts that builds the ~210 token delegation protocol string injected into the system prompt
**Where**: `src/router/protocol.ts`
**Depends on**: T2
**Reuses**: Config types from config.ts

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `buildDelegationProtocol(cfg)` returns compact string with tiers, cost ratios, mode, task patterns, and rules
- [ ] Protocol format matches reference: `## Model Delegation Protocol\nTiers: @fast=model(Nx) @medium=model(Nx) @heavy=model(Nx) mode:X\nR: @fast→keyword/... @medium→... @heavy→...`
- [ ] Each mode (normal/budget/quality/deep) produces a different protocol string with correct defaultTier emphasis
- [ ] `classifyTask(text, taskPatterns)` returns `"fast" | "medium" | "heavy" | null` based on keyword matching
- [ ] Classification is case-insensitive and matches on word boundaries
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit (coverage: all modes produce correct string; each keyword maps to correct tier; unknown input returns null; cost ratios rendered correctly)
**Gate**: quick
**Commit**: `feat(opencode-tier-router): add protocol builder and task classifier`

---

### T4: Implement Task Classifier

**What**: Create classifier.ts that classifies a task text into a tier using keyword matching from taskPatterns
**Where**: `src/router/classifier.ts`
**Depends on**: T3 (uses protocol types, but functionally independent — can be done in parallel or sequential)
**Reuses**: Types from config.ts

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `classifyTask(text, patterns)` returns the matching tier key
- [ ] Priority: if multiple tiers match, the most specific (highest-priority) tier wins. Priority: heavy > medium > fast.
- [ ] Case-insensitive matching
- [ ] Word-boundary matching (e.g., "debug" in "debugging" should match; but only if pattern matches)
- [ ] Returns `null` when no pattern matches
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit (coverage: every keyword from tiers.json maps correctly; mixed keywords resolve to highest priority; no match returns null; case insensitive)
**Gate**: quick
**Commit**: `feat(opencode-tier-router): add task classifier with priority-based keyword matching`

---

### T5: Implement Cap Tracker and Redundancy Detection [P]

**What**: Create caps.ts with per-subagent cap tracking, banner generation, and redundancy detection via tool-call fingerprinting
**Where**: `src/router/caps.ts`
**Depends on**: T4
**Reuses**: Existing patterns from reference implementation

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `createCapTracker()` returns an object with `record(sessionId, tool, args)` and `getBanner(sessionId, tool, args)` methods
- [ ] Cap counter increments per read-only tool call (grep/read/glob/ls); resets per session
- [ ] Banner format matches spec: `[cap: N/MAX]` below cap, `[⚠ CAP WARNING: N remaining]` approaching, `[⚠ CAP REACHED (N/MAX)]` at cap
- [ ] Redundancy detection creates a deterministic fingerprint of each tool call (e.g., `"read:/path/to/file"`, `"grep:pattern:path"`)
- [ ] Same fingerprint within session → `[⚠ REDUNDANT: this is the same X you ran at call #N]`
- [ ] Different tools or different args → no redundancy
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit (coverage: counter increments; banners at each level; redundancy fingerprints match; same grep different args = not redundant; session isolation)
**Gate**: quick
**Commit**: `feat(opencode-tier-router): add cap tracker with redundancy detection and banners`

---

### T6: Implement Narration Detector [P]

**What**: Create narration.ts with regex patterns and a detection function that identifies Claude narration patterns in completed text
**Where**: `src/narration.ts`
**Depends on**: T4
**Reuses**: — (standalone module)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `NARRATION_PATTERNS` array contains regexes for: "Still writing/implementing/working on the X", "Now I'll write/implement/add the X", "Let me write/implement/add the X", "I'll now write/implement the X", "Going to write/implement the X"
- [ ] `detectNarration(text)` returns `null` for clean text
- [ ] `detectNarration(text)` returns matched pattern string for text containing narration
- [ ] False positives minimized — the word "writing" in "reading and writing files" should NOT match
- [ ] Gate check passes: `npx vitest run`

**Tests**: unit (coverage: each NARRATION_PATTERN matches; clean text returns null; partial matches don't trigger; known false positives pass through)
**Gate**: quick
**Commit**: `feat(opencode-tier-router): add narration detection for Claude thinking-mode commentary`

---

### T7: Implement Plugin Entry Point and Commands

**What**: Wire all hooks in index.ts: config hook (registers tier agents + commands), system.transform (injects protocol), tool.execute.after (caps banners), experimental.text.complete (narration), and command.execute.before (/tiers, /budget)
**Where**: `src/index.ts`
**Depends on**: T2, T3, T5, T6
**Reuses**: All prior modules

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Plugin exports default factory function `(ctx: PluginInput) => Plugin`
- [ ] `config` hook registers three subagent agents (fast/medium/heavy) with models from tiers.json
- [ ] `config` hook registers commands `/tiers` and `/budget` with descriptions and templates
- [ ] `experimental.chat.system.transform` hook injects delegation protocol from protocol.ts — skips injection for subagent sessions
- [ ] `tool.execute.after` hook calls capTracker.record() and appends banners to read-only tool results
- [ ] `experimental.text.complete` hook calls detectNarration() and appends `[⚠ narration detected: "..."]` on match
- [ ] `command.execute.before` hook dispatches `/tiers` (shows active config) and `/budget` (switches mode, persists via config.saveMode())
- [ ] All hooks wrapped in try/catch with `// best-effort: never crash a real session`
- [ ] Build gate passes: `npx tsc --noEmit`
- [ ] `npx vitest run` passes (existing tests from prior tasks)

**Tests**: none (integration-level — needs OpenCode runtime)
**Gate**: build
**Commit**: `feat(opencode-tier-router): wire plugin entry point with all hooks and commands`

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Scaffold | 3 config files | ✅ Granular (cohesive — project foundation) |
| T2: config.ts | 1 module | ✅ Granular |
| T3: protocol.ts | 1 module | ✅ Granular |
| T4: classifier.ts | 1 module | ✅ Granular |
| T5: caps.ts | 1 module | ✅ Granular |
| T6: narration.ts | 1 module | ✅ Granular |
| T7: index.ts | 1 entry point + command wiring | ⚠️ OK — commands are registered in the same hook scope |
| T8 | — | — |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | Phase 1 root | ✅ Match |
| T2 | T1 | Phase 1: T1→T2 | ✅ Match |
| T3 | T2 | Phase 2: T2→T3 | ✅ Match |
| T4 | T3 | Phase 2: T3→T4 | ✅ Match |
| T5 | T4 | Phase 3: T4→T5 | ✅ Match |
| T6 | T4 | Phase 3: T4→T6 | ✅ Match |
| T7 | T2, T3, T5, T6 | Phase 4: T5,T6→T7 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1: Scaffold | config files | none | none | ✅ OK |
| T2: config.ts | service/domain | unit | unit | ✅ OK |
| T3: protocol.ts | service/domain | unit | unit | ✅ OK |
| T4: classifier.ts | service/domain | unit | unit | ✅ OK |
| T5: caps.ts | service/domain | unit | unit | ✅ OK |
| T6: narration.ts | service/domain | unit | unit | ✅ OK |
| T7: index.ts | plugin entry | none | none | ✅ OK |
