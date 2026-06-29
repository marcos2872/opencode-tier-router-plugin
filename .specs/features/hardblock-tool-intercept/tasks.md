# Hardblock Tool Intercept — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: Skipped (Medium scope — design inline in context.md)
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase — confirm before Execute. Guidelines found: `AGENTS.md`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Router logic (plugin-orchestrator.ts) | unit | All branches; 1:1 to spec ACs; every listed edge case | `test/index.test.ts` | `npx vitest run` |
| Constants | unit | Key paths + new constant export | `test/index.test.ts` | `npx vitest run` |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | Yes | Per-test fresh plugin instance via `tierRouterPlugin(makeCtx(...))` | `test/index.test.ts` — each `it()` creates its own plugin |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests | `npx vitest run` |
| Full | After phase completion | `npm run typecheck && npx vitest run && npm run lint` |

---

## Execution Plan

### Phase 1: Foundation (Sequential)

```
T1 → T2 → T3 → T4
```

All tasks are sequential because each builds on the previous one.

---

## Task Breakdown

### T1: Add DELEGATION_TMP_DIR constant

**What**: Export `DELEGATION_TMP_DIR` constant pointing to `/tmp/opencode-router-model`
**Where**: `src/constants.ts`
**Depends on**: None
**Reuses**: Existing constant pattern in constants.ts

**Done when**:
- [ ] `DELEGATION_TMP_DIR` exported as `'/tmp/opencode-router-model'`
- [ ] TypeScript compiles without errors
- [ ] Importable by other modules

**Tests**: none (constant only)
**Gate**: build (`npm run typecheck`)

### T2: Create ensureDelegationFile + cleanupDelegationFile methods

**What**: Add two private methods to PluginOrchestrator:
- `ensureDelegationFile(sessionID: string, tier: string): Promise<string>` — creates `/tmp/opencode-router-model/{sessionID}.md` with content from `buildHardBlockDelegationMessage(tier)`, creates directory if needed. Returns the file path.
- `cleanupDelegationFile(sessionID: string): Promise<void>` — removes the delegation file for the session.

Call `ensureDelegationFile` in `handleChatMessage` when hard-block is activated (line 629 after `this.hardBlockedSessions.set(...)`).
Call `cleanupDelegationFile` in `clearSessionRouterState`.

**Where**: `src/plugin-orchestrator.ts`
**Depends on**: T1
**Reuses**: `DELEGATION_TMP_DIR` from constants, `buildHardBlockDelegationMessage` from prompts

**Done when**:
- [ ] `ensureDelegationFile` creates directory + file with correct content
- [ ] `cleanupDelegationFile` removes the file
- [ ] Called at the right points in handleChatMessage and clearSessionRouterState
- [ ] No TypeScript errors
- [ ] Tests prove file is created with correct content

**Tests**: unit (file creation, content check, cleanup)
**Gate**: quick (`npx vitest run`)

### T3: Implement redirect logic in handleToolExecuteBefore

**What**: Replace the current `output.allow = false` / `output.message = ...` block (lines 889-892) with arg redirection per tool type. Create a private method `redirectToolArgs(tool: string, tier: string, args: Record<string, unknown>): void` that modifies args for each blocked tool:

- `bash`: `args.command` → `echo "Delegue para @{tier}. Esta ferramenta esta bloqueada para execucao direta."`
- `read`: `args.filePath` → path to delegation file from `ensureDelegationFile`
- `grep`: `args.include` → path to delegation file, `args.pattern` → `"Delegue"`
- `glob`: `args.pattern` → `"*"`, `args.path` → DELEGATION_TMP_DIR
- `list`: `args.path` → DELEGATION_TMP_DIR
- `edit`/`write`: `args.filePath` → `"/dev/null"`

Also update the main block in `handleToolExecuteBefore` to:
- Remove `delete output.args`, `delete output.message`, `output.allow = false`, `output.message = ...`
- Call `this.redirectToolArgs(input.tool, tier, output.args)` instead
- Ensure HBTI-10 (args undefined) and HBTI-12 (missing properties) are handled

**Where**: `src/plugin-orchestrator.ts` (~lines 883-892)
**Depends on**: T2
**Reuses**: `ensureDelegationFile` from T2, `DELEGATION_TMP_DIR` from T1

**Done when**:
- [ ] bash command redirects to echo with delegation message
- [ ] read filePath points to delegation file
- [ ] grep include/pattern targets delegation file
- [ ] glob pattern/path targets delegation dir
- [ ] list path targets delegation dir
- [ ] edit/write filePath = /dev/null
- [ ] Subagent sessions are NOT affected (HBTI-08)
- [ ] Non-hard-blocked sessions are NOT affected (HBTI-11)
- [ ] args undefined is handled safely (HBTI-10)
- [ ] args without required properties are initialized (HBTI-12)
- [ ] Toast still appears with correct tier (HBTI-01)
- [ ] No TypeScript errors

**Tests**: unit (per-tool redirect, subagent bypass, non-blocked bypass)
**Gate**: quick (`npx vitest run`)

### T4: Update tests

**What**: Update existing tests and add new ones:
- Update tests that previously expected `{ allow: false, message: buildHardBlockDelegationMessage('heavy') }` to expect redirected args instead
- For bash: expect `output.args.command` to contain "Delegue para @heavy"
- For read: expect `output.args.filePath` to be the delegation file path
- Add tests for each tool type (bash, read, grep, glob, list, edit, write)
- Add tests for HBTI-08 (subagent not affected), HBTI-10 (args undefined), HBTI-11 (not hard-blocked), HBTI-12 (missing properties)
- Keep existing toast assertion (notifyToolBlocked still works)
- Keep existing `touchSession` assertion (T4 from HBTM)

**Where**: `test/index.test.ts`
**Depends on**: T3
**Reuses**: Existing test patterns (makeCtx, classifyHardBlocked, etc.)

**Done when**:
- [ ] All old tests updated to use new assertion pattern
- [ ] One test per tool type added
- [ ] Subagent bypass test added
- [ ] Edge case tests added (HBTI-10, HBTI-11, HBTI-12)
- [ ] `npx vitest run` passes with expected test count
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

**Tests**: unit
**Gate**: full (`npm run typecheck && npx vitest run && npm run lint`)