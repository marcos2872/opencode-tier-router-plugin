# Wiki Alignment Validation

**Date**: 2026-06-28
**Spec**: `.specs/features/wiki-alignment/spec.md`
**Diff range**: `9c5d9ec..HEAD`; working tree also contains uncommitted changes in `test/enforcement-integration.spec.ts`, `test/enforcement-validator.spec.ts`, and untracked `.specs/features/wiki-alignment/validation.md`. The verifier did not stage, commit, stash, or modify those working-tree changes.
**Verifier**: independent verifier, scratch-only mutation sensor

---

## Task Completion

T1..T32 are marked complete in `.specs/features/wiki-alignment/tasks.md`.

| Task | Status | Evidence |
| ---- | ------ | -------- |
| T1 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:42` |
| T2 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:58` |
| T3 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:70` |
| T4 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:82` |
| T5 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:95` |
| T6 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:113` |
| T7 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:125` |
| T8 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:143` |
| T9 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:155` |
| T10 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:170` |
| T11 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T12 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T13 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T14 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T15 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T16 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T17 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T18 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T19 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:185` |
| T20 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:230` |
| T21 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:242` |
| T22 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:254` |
| T23 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:266` |
| T24 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:281` |
| T25 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:297` |
| T26 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:316` |
| T27 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:342` |
| T28 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:357` |
| T29 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:371` |
| T30 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:392` |
| T31 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:408` |
| T32 | ✅ Done | `.specs/features/wiki-alignment/tasks.md:420` |

---

## Spec-Anchored Acceptance Criteria

| Criterion from spec.md | Spec-defined outcome | File:line + assertion expression | Result |
| ---------------------- | -------------------- | -------------------------------- | ------ |
| `npm run typecheck` passes | Typecheck succeeds. | Gate command only; no source assertion expression in spec. | ⚠️ Gate passed, not AC-traced |
| `npx vitest run` passes with ≥ current test count | Test suite passes; baseline for “current test count” is not specified in spec. | Gate command only; current run reported `PASS (149) FAIL (0)`. | ⚠️ Gate passed; baseline precision gap |
| `@opencode-ai/sdk` declared in peerDependencies | Peer dependency present. | `package.json:20` — grep found `"@opencode-ai/sdk": ">=1.0.0"`. | ✅ PASS |
| No `console.warn` in `src/`; `client.app.log()` used at init, classification, hard-block, errors; FileLogger used for debug-only | Runtime logging uses app log and FileLogger, zero console logging in `src/`. | `test/index.test.ts:119-128` — `expect(appLog).toHaveBeenCalledWith(... 'Plugin initialized' ...)`; `test/index.test.ts:160-168` — `expect(appLog).toHaveBeenCalledWith(... 'Tier selected' ...)`; `test/index.test.ts:184-192` — `expect(appLog).toHaveBeenCalledWith(... 'Hard-block triggered' ...)`; `test/index.test.ts:203-215` — `expect(appLog).toHaveBeenCalledWith(... 'Hook failed' ...)`; `grep "console\." src/` — 0 matches. | ✅ PASS |
| Subagents cannot delegate via `task()` | Subagent `task` permission is denied; primary hard-blocked `task` remains allowed. | `test/index.test.ts:1085-1116` — `expect(askOut.status).toBe('deny')`; `src/router/permissions.ts:35-36` — returns `{ status: 'deny' }` for subagent `task`. | ✅ PASS |
| `/budget <mode>` immediately affects routing | `/budget quality` updates in-memory mode and routing uses quality defaults. | `test/index.test.ts:347-391` — `expect(text).toContain('Mode: quality')` and `expect(text).toContain('Preferred tier (current session): @medium via fallback-default')`. | ✅ PASS |
| `tool.execute.before` blocks denied tools only for hard-blocked main sessions; subagent sessions pass through; sensitive-file protection documented | Denied native tools return exact delegation hint; `task` is not blocked; subagents pass through; blocked attempts audit. | `test/index.test.ts:787-795` — `expect(toolOut).toEqual({ allow: false, message: HARD_BLOCK_DELEGATION_MESSAGE })`; `test/index.test.ts:834-857` — `expect(toolOut).toEqual({ allow: true, args: { path: 'src/index.ts' } })`; `test/index.test.ts:898-915` — `expect(infoSpy).toHaveBeenCalledWith('Denied tool blocked before execution', ...)`; `docs/projeto.md:143-158` documents denied set, subagent exemption, and sensitive-file audit. | ✅ PASS |
| `shell.env` injects router env vars into subagent shells | Subagent shell receives `OPENCODE_ROUTER_TIER`, `OPENCODE_ROUTER_MODE`, `OPENCODE_ROUTER_HARD_BLOCKED`; main shell is unaffected. | `test/index.test.ts:627-674` — `expect(subagentOut).toEqual(...)` and `expect(mainOut).toEqual({ env: { PATH: '/bin', [OPENCODE_ROUTER_MODE]: 'legacy' } })`. | ✅ PASS |
| `experimental.session.compacting` preserves routing fields | `preferredTier`, `selectionSource`, `hardBlockedTier`, and `hardBlockReason` are preserved in `output.context.router`. | `test/index.test.ts:677-704` — `expect(output).toEqual({ context: { router: { preferredTier: 'heavy', selectionSource: 'keyword', hardBlockedTier: 'heavy', hardBlockReason: ..., kept: 'output-router-state' } } })`. | ✅ PASS |
| Notifications sent for hard-blocked tool access via `client.tui.showToast()` | Blocked hard-blocked tool access calls TUI toast with warning body. | `test/index.test.ts:799-818` — `expect(tuiShowToast).toHaveBeenCalledWith({ body: { title: 'Acao bloqueada', message: 'Delegue para @heavy.', variant: 'warning', duration: 8000 } })`. | ✅ PASS |
| Permissions matrix enforced: hard-blocked sessions deny tools, subagents deny `task()`, primary sessions allow all | Native tools denied for hard-blocked primary sessions; task/custom allowed for primary; task denied for subagents; event hook rejects native and allows task. | `test/index.test.ts:732-771` — `expect(askOut.status).toBe('deny')`; `test/index.test.ts:1020-1059` — `expect(askOut.status).toBe('allow')`; `test/index.test.ts:1062-1082` — `expect(askOut.status).toBe('allow')`; `test/index.test.ts:1085-1116` — `expect(askOut.status).toBe('deny')`; `test/index.test.ts:1119-1159` — `expect(postPermission).toHaveBeenLastCalledWith({ body: { response: 'reject' } })` and `{ response: 'once' }`; `src/router/permissions.ts:24-43` defines matrix logic. | ✅ PASS |
| All test files follow AAA, PT-BR, import order, vi.spyOn patterns | Test style aligned across 9 files. | `npm run lint` and `npm run format` are quality gates, not file assertion expressions; both failed in this validation. | ❌ Gap |
| `.opencode/commands/tiers.md`, `budget.md`, `router.md` exist | Command templates exist. | File-existence check passed; no assertion expression in test suite. File evidence: `.opencode/commands/tiers.md:1-29`, `.opencode/commands/budget.md:1-29`, `.opencode/commands/router.md:1-29`. | ⚠️ File-existence gap |
| `.opencode/tools/` directory exists with standalone `router_status` tool | Standalone tool exports current routing state JSON. | `test/index.test.ts:418-450` — `expect(state).toEqual(expect.objectContaining({ enabled: true, mode: 'normal', hardBlockCount: 0, tiers: ... }))` and `expect(state.hardBlockCount).toBe(1)`; `.opencode/tools/router_status.js:93-111` — `buildRouterStatus` returns `enabled`, `mode`, `tiers`, `hardBlockCount`; `routerStatus` returns `JSON.stringify`. | ✅ PASS |
| SDK OpenCode explicitly marked N/A in docs | OpenCode SDK instantiation is out of scope. | `docs/projeto.md:97`; `ENFORCEMENT.md:115`; `.specs/STATE.md:137`. | ✅ PASS |
| Skills de agentes explicitly marked N/A in docs | Agent skills are out of scope. | `ENFORCEMENT.md:116`; `.specs/STATE.md:145`. | ✅ PASS |

**Status**: ❌ Gaps present

---

## Discrimination Sensor

**Sensor depth**: lightweight, scratch-only worktree mutation.
**Scratch state**: `git worktree add --detach /tmp/wiki-alignment-sensor HEAD`; used `/tmp/wiki-alignment-sensor/node_modules` symlink from the main repo for dependencies; scratch removed after validation.

| Mutation | File:line | Description | Result |
| -------- | --------- | ----------- | ------ |
| 1 | `src/plugin-orchestrator.ts:954-956` | Mutated `/budget` in-memory reload to force `mode: 'normal'`. | ✅ Killed by `test/index.test.ts:347-391` (`expect(text).toContain('Mode: quality')`). |
| 2 | `src/plugin-orchestrator.ts:790-801` | Mutated hard-blocked denied native tool handling to return `{ allow: true }`. | ✅ Killed by `test/index.test.ts:787-795`, `test/index.test.ts:799-818`, and `test/index.test.ts:898-915`. |
| 3 | `src/plugin-orchestrator.ts:792` | Removed `notifyToolBlocked(tier)` call. | ✅ Killed by `test/index.test.ts:799-818` (`expect(tuiShowToast).toHaveBeenCalledWith(...)`). |
| 4 | `src/router/permissions.ts:39-40` | Mutated hard-blocked native permission from deny to allow. | ✅ Killed by `test/index.test.ts:732-771`, `test/index.test.ts:787-795`, and `test/index.test.ts:1119-1159`. |
| 5 | `src/plugin-orchestrator.ts:270-276` | Removed router env merge from `shell.env`. | ✅ Killed by `test/index.test.ts:627-674`. |
| 6 | `src/plugin-orchestrator.ts:316-322` | Mutated session compaction to preserve existing context only. | ✅ Killed by `test/index.test.ts:677-704`. |
| 7 | `src/plugin-orchestrator.ts:356-358` | Mutated `router_status` hard-block count to `0`. | ✅ Killed by `test/index.test.ts:441-450`. |
| 8 | `src/router/permissions.ts:35-36` | Mutated subagent `task` permission from deny to allow. | ✅ Killed by `test/index.test.ts:1085-1116`. |

**Sensor result**: 8/8 mutations killed, 0 survived — PASS ✅.

---

## Gate Check

| Gate | Command | Result | Evidence |
| ---- | ------- | ------ | -------- |
| Typecheck + tests | `npm run typecheck && npx vitest run` | ✅ Passed | `PASS (149) FAIL (0)`; exit status 0. |
| Build | `npm run build` | ✅ Passed | `tsc` exited with status 0. |

**Test count**: 149 passed, 0 failed.
**Build-level gate**: 2 commands passed, 0 failed.
**Before-feature test count**: not available in the provided diff surface/spec; no baseline count was provided.

---

## Code Quality

| Check | Result | Evidence |
| ----- | ------ | -------- |
| `grep "console\." src/` | ✅ PASS | 0 matches for `console\.`. |
| `grep "task: 'allow'" src/` | ✅ PASS | 0 matches for `task: 'allow'`. |
| `npm run lint` | ❌ Failed | Exit status 1; 1 error and 34 warnings. Error at `src/plugin-orchestrator.ts:686` (`@typescript-eslint/no-unsafe-function-type`). Warnings include `@typescript-eslint/no-explicit-any` in `src/index.ts`, unused vars in `src/plugin-orchestrator.ts` and `src/router/permissions.ts`, and an unused test variable in `test/index.test.ts:117`. |
| `npm run format` | ❌ Failed | Exit status 1; Prettier reported 6 files needing formatting: `src/plugin-orchestrator.ts`, `src/utils/logger.ts`, `test/enforcement-integration.spec.ts`, `test/enforcement-validator.spec.ts`, `test/index.test.ts`, `test/narration.test.ts`. |

---

## Edge Cases

- Hard-blocked primary native tools are denied while `task` and custom permissions remain allowed: `test/index.test.ts:1062-1082` and `test/index.test.ts:1119-1159`.
- Subagent `task()` is denied even when the router is otherwise enabled: `test/index.test.ts:1085-1116`.
- Subagent `tool.execute.before` bypasses hard-block denial and normalizes tool args: `test/index.test.ts:834-857` and `test/index.test.ts:860-895`.
- Main shell env is not polluted by router env vars: `test/index.test.ts:663-674`.
- Session compaction preserves existing `router.kept` while overwriting router state fields: `test/index.test.ts:677-704`.
- Invalid `/budget` modes list available modes and preserve current mode: `test/index.test.ts:394-403`.
- Missing `client.app.log()` is handled silently while config still initializes: `test/index.test.ts:131-138`.
- Silent TUI fallback when `client.tui.showToast` is unavailable is implemented in `src/plugin-orchestrator.ts:224-240` but has no dedicated assertion test.

---

## Requirement Traceability Update

| Requirement | Previous status | New validation status |
| ----------- | --------------- | --------------------- |
| ALIGN-01..ALIGN-32 | Complete in `tasks.md` | Runtime, config, source, docs, and test-alignment items mostly verified; code-quality gates and a few spec-precision gaps remain. |

---

## Summary

**Overall**: ❌ FAIL

**Spec-anchored check**: 14/16 ACs matched spec outcome | 2 spec-precision gaps flagged; 1 test-style gap is a quality failure.

**Gate**: 2 passed, 0 failed.

**Sensor**: 8 mutations injected, 8 killed, 0 survived.

**What works**:
- Build-level gates passed: typecheck/tests and build.
- Runtime behaviors for budget reload, hard-block routing, permissions, shell env, compaction, router status, and notifications are covered by assertions.
- Scratch discrimination sensor killed all injected mutants.

**Issues found**:
1. `npm run lint` fails with exit status 1 and `src/plugin-orchestrator.ts:686` is an actionable lint error.
2. `npm run format` fails with exit status 1 across 6 files.
3. `npx vitest run` baseline for “≥ current test count” is unspecified in the spec.
4. `.opencode/commands/*.md` existence is verified by file-existence check only, not by an assertion expression.
5. Silent TUI fallback for missing `client.tui.showToast` is implemented but not separately asserted.

**Next steps**: fix lint/format failures and strengthen the few uncovered or imprecise criteria; do not change the sensor results.

---

## Ranked gaps

1. `npm run lint` and `npm run format` fail | code quality from `validate.md` | `src/plugin-orchestrator.ts:686`; `src/utils/logger.ts`; `test/enforcement-integration.spec.ts`; `test/enforcement-validator.spec.ts`; `test/index.test.ts`; `test/narration.test.ts`
2. `npx vitest run` success criterion has no specified baseline for “≥ current test count” | spec success criteria | no evidence; gate output is `PASS (149) FAIL (0)`
3. `.opencode/commands/*.md` existence is not tied to an assertion expression | spec success criteria | `.opencode/commands/tiers.md:1-29`, `.opencode/commands/budget.md:1-29`, `.opencode/commands/router.md:1-29`
4. Silent TUI fallback when `client.tui.showToast` is unavailable is not asserted | T28 notification support | `src/plugin-orchestrator.ts:224-240`
