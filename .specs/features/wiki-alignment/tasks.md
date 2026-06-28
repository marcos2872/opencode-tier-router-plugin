# Wiki Alignment Tasks

## Execution Protocol

Implement with `tlc-spec-driven` skill.

---

**Design**: none
**Status**: Draft

---

## Priority Execution Order

```
Phase 0 (P0 — Runtime Bugs):
  T1 → T2
  T3 [P]
  T4 [P]
  T5 [P]
  T6 [P]

Phase 1 (P1 — Observability + Blocking + Permissions):
  T7, T8, T24, T27, T28, T29 (parallel)

Phase 2 (P2 — Session Lifecycle — expanded contracts):
  T9, T10 (sequential: T10 depends on T6 context)
  T25, T26 (parallel, expand contracts alongside T9/T10)

Phase 3 (P3 — Test Files — all parallel, independent):
  T11..T19 (9 tasks, each touches a different file)

Phase 4 (P4 — Polish + N/A scope):
  T20, T21/T30, T22, T23, T31, T32
```

---

## Task Breakdown

### T1: Fix config reload after `/budget` mode switch
**Onde**: `src/plugin-orchestrator.ts:613`
**Req**: ALIGN-01

```diff
  await saveMode(modeName, this.ctx.directory);
+ this.config = { ...this.config, mode: modeName };
  output.parts = [makeTextPart(input.sessionID, `Switched to ${modeName} mode.`)];
```

**Done when**: `this.config.mode` reflects new mode immediately after `/budget`
**Gate**: `npx vitest run`

---

### T2: Add test for in-memory config update after mode switch
**Onde**: `test/index.test.ts` (após teste `/budget <mode> persists mode`)
**Req**: ALIGN-02

Test: `/budget quality` → simulated `chat.message` → verify preferred tier reflects quality mode defaults.

**Done when**: Test passes verifying `/tiers` shows `Mode: quality` after `/budget quality`
**Gate**: `npx vitest run`

---

### T3: Remove `task: 'allow'` from subagent permissions
**Onde**: `src/plugin-orchestrator.ts:160`
**Req**: ALIGN-03

Delete line `task: 'allow',` from the subagent permission block in `handleConfig`.

**Done when**: Subagent config has no `task` in permissions
**Gate**: `npx vitest run`

---

### T4: Replace `console.warn` with FileLogger in enforcement-validator
**Onde**: `src/router/enforcement-validator.ts:136`, `src/plugin-orchestrator.ts:122-132`
**Req**: ALIGN-04

- Remove `console.warn` call from `assertEnforcement`
- `handleConfig` should log enforcement warnings via `this.log.warn()`

**Done when**: `grep "console.warn" src/` returns 0 (excluding comments)
**Gate**: `npm run typecheck && npx vitest run`

---

### T5: Add `@opencode-ai/sdk` to peerDependencies
**Onde**: `package.json:18-20`
**Req**: ALIGN-05

```diff
  "peerDependencies": {
-   "@opencode-ai/plugin": ">=1.0.0"
+   "@opencode-ai/plugin": ">=1.0.0",
+   "@opencode-ai/sdk": ">=1.0.0"
  }
```

**Done when**: Declared in peerDependencies, `npm install` clean
**Gate**: `npm run typecheck`

---

### T6: Expand PluginOrchestrator context
**Onde**: `src/plugin-orchestrator.ts:84-89`, `src/index.ts:161-162`
**Req**: ALIGN-06

Expand constructor type to accept `project`, `$`, `worktree`. Pass full ctx from `index.ts`.

**Done when**: `this.ctx.project`, `this.ctx.$`, `this.ctx.worktree` accessible
**Gate**: `npm run typecheck && npx vitest run`

---

### T7: Add `client.app.log()` for observability
**Onde**: `src/plugin-orchestrator.ts` (new helper + calls)
**Req**: ALIGN-07

Helper `logObservable(level, message, data?)` that calls `client.app.log()` when available.

Call at:
- Plugin init: `'Plugin initialized'`
- Classification: `'Tier selected', { tier, source }`
- Hard-block: `'Hard-block triggered', { sessionID, tier }`
- All catch blocks: `'Hook failed', { hook, error }`

**Done when**: Called at all 4 points; skipped silently when client unavailable
**Gate**: `npm run typecheck && npx vitest run`

---

### T8: Add `tool.execute.before` for hard-block blocking
**Onde**: `src/plugin-orchestrator.ts` (new method), `src/index.ts` (wire hook)
**Req**: ALIGN-08

Block denied tools (`grep|glob|read|list|bash|edit|write|webfetch|websearch`) for hard-blocked main sessions via `tool.execute.before`. Subagent sessions pass through.

**Done when**: Blocked tools return delegation hints for hard-blocked sessions; subagent sessions unaffected
**Gate**: `npm run typecheck && npx vitest run`

---

### T9: Implement `shell.env` hook
**Onde**: `src/plugin-orchestrator.ts` (new method), `src/index.ts` (wire hook)
**Req**: ALIGN-09

Inject `OPENCODE_ROUTER_TIER`, `OPENCODE_ROUTER_MODE`, `OPENCODE_ROUTER_HARD_BLOCKED` into subagent shells.

**Done when**: Subagent shells receive env vars; non-subagent shells unaffected
**Gate**: `npm run typecheck && npx vitest run`

---

### T10: Implement `experimental.session.compacting`
**Onde**: `src/plugin-orchestrator.ts` (new method), `src/index.ts` (wire hook)
**Req**: ALIGN-10

Preserve `preferredTier`, `selectionSource`, `hardBlockedTier`, `hardBlockReason` in `output.context.router`.

**Done when**: Routing state survives session compaction (verified in unit test)
**Gate**: `npm run typecheck && npx vitest run`

---

### T11..T19: Align 9 test files with Testing Wiki

**Onde**: Each task touches exactly one test file.
**Req**: ALIGN-11..ALIGN-19

Apply ALL applicable guidelines per file:
1. AAA pattern (blank lines between arrange/act/assert)
2. Import order: stdlib → vitest → internal (blank lines)
3. Replace manual mocks with `vi.fn()` / `vi.spyOn()`
4. Add missing error coverage (`it('lança erro quando X')`)
5. Translate `describe`/`it` names to PT-BR
6. Rename category-prefixed describes to `describe('functionName')`
7. Add specific error messages to `toThrow`
8. Remove `// ===` section comment blocks and module-level JSDoc
9. Fix `console.warn` spy lifecycle (use `vi.spyOn` + `mockRestore()`)

| Task | File | Specific Findings |
| ---- | ---- | ----------------- |
| T11 | `test/caps.test.ts` | AAA, import, error cov, PT-BR |
| T12 | `test/classifier.test.ts` | AAA, import, error cov, PT-BR |
| T13 | `test/protocol.test.ts` | AAA, import, error cov, PT-BR |
| T14 | `test/narration.test.ts` | AAA, import, error cov, PT-BR |
| T15 | `test/selector.test.ts` | AAA, import, mock manual, PT-BR |
| T16 | `test/config.test.ts` | PT-BR, toThrow messages |
| T17 | `test/enforcement-validator.spec.ts` | Import, describe names, PT-BR, comments |
| T18 | `test/enforcement-integration.spec.ts` | Import, describe names, PT-BR, comments |
| T19 | `test/index.test.ts` | Mock manual of console.warn, spy lifecycle, PT-BR |

**Done when**: All 9 files pass lint + tests with same behavior (verified by `git diff --stat`)
**Gate**: `npx vitest run`

---

### T20: Create `.opencode/commands/` template files
**Onde**: `.opencode/commands/tiers.md`, `.opencode/commands/budget.md`, `.opencode/commands/router.md`
**Req**: ALIGN-20

Create 3 Markdown files with YAML frontmatter describing command usage per wiki template pattern.

**Done when**: All 3 files exist with valid template format
**Gate**: N/A

---

### T21: Create `router_status` custom tool
**Onde**: `src/plugin-orchestrator.ts` (new method `getRoutingState`), `src/index.ts`
**Req**: ALIGN-21

Expose `router_status` tool that returns current routing state (enabled, mode, tiers, hard-block count).

**Done when**: Tool registered and returns routing state JSON
**Gate**: `npm run typecheck && npx vitest run`

---

### T22: Add `tool.execute.before` arg normalization for subagents
**Onde**: `src/plugin-orchestrator.ts` (extend T8 method)
**Req**: ALIGN-22

Normalize subagent tool args (trim trailing whitespace from paths). Audit via FileLogger.

**Done when**: Subagent paths are trimmed; audit logged
**Gate**: `npm run typecheck && npx vitest run`

---

### T23: Update tsconfig.json module (optional)
**Onde**: `tsconfig.json:4`
**Req**: ALIGN-23

```diff
- "module": "preserve",
+ "module": "NodeNext",
```

**Done when**: `npm run typecheck && npx vitest run && npm run build` pass
**Gate**: full

---

### T24: Add `tool.execute.before` detailed contract
**Onde**: `src/plugin-orchestrator.ts` (expand T8 method), `docs/` (contract docs)
**Req**: ALIGN-24

Expand T8 to include:
- **Denied tool set**: `grep|glob|read|list|bash|edit|write|webfetch|websearch` — document as a constant in `src/constants.ts`
- **Subagent exemption**: if session is subagent, return `{ allow: true }` immediately
- **Sensitive-file protection semantics**: log via FileLogger when a hard-blocked session attempts a denied tool
- **Return format**: `{ allow: false, message: "Delegue para @heavy. Esta ferramenta esta bloqueada para execucao direta." }`

**Done when**: Contract documented in code + tests cover denied set, subagent bypass, sensitive-file logging
**Gate**: `npm run typecheck && npx vitest run`

---

### T25: Add `shell.env` detailed contract
**Onde**: `src/plugin-orchestrator.ts` (expand T9), `src/constants.ts`
**Req**: ALIGN-25

Expand T9 to include:
- **Payload**: function receives `{ env: Record<string, string> }`, returns `{ env: Record<string, string> }`
- **Output format**: merge `OPENCODE_ROUTER_TIER`, `OPENCODE_ROUTER_MODE`, `OPENCODE_ROUTER_HARD_BLOCKED` into `env`
- **Subagent-only**: only inject when session is subagent (`session.conversationSettings.systemPrompt?.includes?.('subagent profile')`)
- **Test**: verify env vars present in subagent shell, absent in main shell

**Done when**: All three env vars injected for subagent shells; zero injection for main shells
**Gate**: `npm run typecheck && npx vitest run`

---

### T26: Add `experimental.session.compacting` detailed contract
**Onde**: `src/plugin-orchestrator.ts` (expand T10), `src/router/types.ts`
**Req**: ALIGN-26

Expand T10 to include:
- **Payload**: receives `{ input: { context: any }, output: { context: any } }`
- **State to preserve** in `output.context.router`:
  ```ts
  {
    preferredTier: string,
    selectionSource: string,
    hardBlockedTier: string | null,
    hardBlockReason: string | null
  }
  ```
- **Merge logic**: spread existing `output.context.router` first, then overwrite with current state

**Done when**: Compaction round-trip preserves all 4 fields; test verifies state survives compression
**Gate**: `npm run typecheck && npx vitest run`

---

### T27: Establish logging hierarchy
**Onde**: `src/plugin-orchestrator.ts`, `src/index.ts`
**Req**: ALIGN-27

Refine logging (evolui T4, T7):
- `client.app.log()` is primary logger for user-observable events: init, classification, hard-block, errors
- `FileLogger` is secondary for debug/audit: subagent routing, tool normalization, local-only diagnostics
- Ensure zero `console.warn` in `src/` (already covered by T4 — verify via `grep -r "console\.\(warn\|log\|error\)" src/`)

**Done when**: Logging hierarchy documented and enforced; grep for `console.` in `src/` returns zero
**Gate**: `npm run typecheck && npx vitest run`

---

### T28: Add notification support
**Onde**: `src/plugin-orchestrator.ts` (extend hard-block handler), `src/index.ts`
**Req**: ALIGN-28

When a hard-blocked session attempts a denied tool:
- Call `client.tui.showToast({ type: 'warning', title: 'Acao bloqueada', message: 'Delegue para @heavy.' })`
- Fall back silently if `client.tui` unavailable (embed in try/catch, best-effort)

**Done when**: Toast triggered on hard-blocked tool invocation; no crash if `tui` missing
**Gate**: `npm run typecheck && npx vitest run`

---

### T29: Define permissions matrix
**Onde**: `ENFORCEMENT.md` (document), `src/router/permissions.ts` (new file)
**Req**: ALIGN-29

Create a permissions matrix:

| Session type | `task()` | native tools (grep/bash/etc) | custom tools |
|---|---|---|---|
| Primary (not hard-blocked) | allow | allow | allow |
| Primary (hard-blocked) | allow | deny | allow |
| Subagent | deny | allow | allow |

- Code: extract permission logic from `PluginOrchestrator` into `src/router/permissions.ts`
- Document matrix in `ENFORCEMENT.md`

**Done when**: Matrix enforced in `permission.ask` + `event` hooks; documented in `ENFORCEMENT.md`
**Gate**: `npm run typecheck && npx vitest run`

---

### T30: Create `.opencode/tools/` directory with `router_status`
**Onde**: `.opencode/tools/router_status.js`
**Req**: ALIGN-30

Per wiki `.opencode/tools/` conventions:
- File name = tool name: `router_status.js`
- Export an async function receiving session context
- Return current routing state as formatted JSON (enabled, mode, tiers, hard-block count)
- Move logic from T21 (in-source `getRoutingState`) to standalone tool

**Done when**: `opencode` detects tool as `router_status`; returns routing state JSON
**Gate**: N/A (requires manual `opencode` session)

---

### T31: Mark SDK OpenCode as N/A
**Onde**: `ENFORCEMENT.md`, `docs/` (if exists), `.specs/STATE.md`
**Req**: ALIGN-31

Add note: "SDK OpenCode (`createOpencode()` / `createOpencodeClient()`) — N/A. Este plugin usa apenas runtime hooks e não instancia clients SDK."

**Done when**: Documented in all relevant docs
**Gate**: N/A

---

### T32: Mark Skills de agentes as N/A
**Onde**: `ENFORCEMENT.md`, `.specs/STATE.md`
**Req**: ALIGN-32

Add note: "Skills de agentes (`SKILL.md`) — N/A. Este plugin não define skills customizadas. A skill `tlc-spec-driven` é carregada por nome via skill tool, não via SKILL.md."

**Done when**: Documented in all relevant docs
**Gate**: N/A

---

### T33: Create `context.md` with validation decisions
**Onde**: `.specs/features/wiki-alignment/context.md`
**Req**: N/A (processo)

Record implementation decisions from this validation:
- Carregamento via `.opencode/opencode.json` mantido (desenvolvimento) — não migrar para `.opencode/plugins/`
- API HTTP do servidor é N/A — plugin não expõe endpoints HTTP
- Zod é opcional e só será usado se custom tools crescerem
- Primary agent profiles não customizados — plugin só mexe em subagentes

**Done when**: `context.md` exists with all decisions above
**Gate**: N/A

---

## Gate Check Commands

| Gate Level | When | Command |
| ---------- | ---- | ------- |
| Quick | After each task | `npx vitest run` |
| Full | After all tasks | `npm run typecheck && npx vitest run` |

---

## Parallel Execution Map

```
Phase 0 (P0):
  T1 → T2
  T3 ────┐
  T4 ────┤
  T5 ────┤
  T6 ────┤ (parallel after T1)
         ↓
Phase 1 (P1):
  T7, T8, T24, T27, T28, T29 (all parallel)
         ↓
Phase 2 (P2):
  T9 → T10 (sequential)
  T25 ────┤
  T26 ────┤ (parallel, expand alongside T9/T10)
         ↓
Phase 3 (P3 — 9 files, all parallel):
  T11 T12 T13 T14 T15 T16 T17 T18 T19
         ↓
Phase 4 (P4 — all parallel):
  T20 T21/T30 T22 T23 T31 T32 T33
         ↓
      Full Gate
```
