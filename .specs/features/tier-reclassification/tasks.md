# Tier Reclassification — Tasks

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
| Config (tiers.json) | none | — (build gate only) | — | build gate only |
| Classifier logic (classifier.ts) | unit | All branches; every new pattern tested; 1:1 to spec ACs | `test/classifier.test.ts`, `test/selector.test.ts` | `npx vitest run` |
| Selector logic (selector.ts) | unit | Stem matching for new patterns; fallback chain | `test/selector.test.ts` | `npx vitest run` |
| Prompts (prompts.ts) | unit | buildSelectorPrompt contains new descriptions | `test/selector.test.ts` | `npx vitest run` |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | Yes | Pure functions with no shared state | `classifier.test.ts` — each test calls `classifyTask()` independently |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `npx vitest run` |
| Full | After phase completion | `npm run typecheck && npx vitest run && npm run lint` |

---

## Execution Plan

### Phase 1: Sequential

All tasks sequential because each builds on the previous, except T2 and T3 which depend on T1.

```
T1 → T2 → T4
  └→ T3 ┘
```

---

## Task Breakdown

### T1: Update taskPatterns in tiers.json

**What**: Add new patterns to `taskPatterns` in tiers.json:
- **fast**: add `git`, `branch`, `commit`, `log`, `diff`, `status`, `push`, `pull`, `merge`, `clone`, `onde`, `oque`, `como`, `qual`, `pergunta`, `duvida`, `doubt`, `arquivo`, `diretorio`, `pasta`
- **medium**: keep existing (optionally remove `atualizar` if too broad)
- **heavy**: add `spec`, `specs`, `task`, `tasks`, `tasks.md`, `rule`, `rules`, `regra`, `regras`, `projeto`, `planejar`, `plan`, `especificacao`, `especificar`

**Where**: `tiers.json` (lines 50-114)
**Depends on**: None
**Reuses**: Existing taskPatterns structure

**Done when**:
- [ ] Fast patterns include git commands
- [ ] Fast patterns include Portuguese question words
- [ ] Heavy patterns include spec/task/rule
- [ ] JSON is valid (no syntax errors)
- [ ] `npm run typecheck` passes (config loading)

**Tests**: none (config file, no test needed)
**Gate**: build (`npm run typecheck`)

### T2: Update stems in selector.ts

**What**: Add stems to hardcoded arrays in `src/router/selector.ts`:
- **FAST_STEMS**: add `'git'`, `'branch'`, `'commit'`, `'log'`, `'diff'`, `'status'`, `'pergunt'`, `'duvid'`, `'doubt'`, `'arquiv'`, `'diretor'`, `'past'`, `'ondef'`, `'oquef'`, `'qual'`
- **HEAVY_STEMS**: add `'spec'`, `'task'`, `'rule'`, `'regr'`, `'projet'`, `'planej'`, `'especific'`, `'estrutur'`, `'sistem'`

**Where**: `src/router/selector.ts` (lines 26-120)
**Depends on**: T1
**Reuses**: Existing stem array pattern

**Done when**:
- [ ] FAST_STEMS contains all new git/question stems
- [ ] HEAVY_STEMS contains all new spec/task/rule stems
- [ ] All stems are lowercase
- [ ] `npm run typecheck` passes

**Tests**: unit (verify classifyByLexicon matches new patterns)
**Gate**: quick (`npx vitest run`)

### T3: Update buildSelectorPrompt in prompts.ts

**What**: Expand the LLM selector prompt descriptions:
```
fast = search/read/list/explore/git/buscar/listar/mostrar/pergunta
medium = implement/refactor/fix/build/update/create/edit/test
heavy = architecture/design/specs/tasks/rules/debug/analyze/review/arquitetura/especificacao/regras
```

**Where**: `src/prompts.ts` (lines 21-30)
**Depends on**: T1
**Reuses**: Existing buildSelectorPrompt structure

**Done when**:
- [ ] fast description includes git, buscar, listar, mostrar, pergunta
- [ ] heavy description includes specs, tasks, rules, arquitetura, especificacao, regras
- [ ] medium description unchanged
- [ ] `npm run typecheck` passes

**Tests**: unit (verify buildSelectorPrompt output contains new strings)
**Gate**: quick (`npx vitest run`)

### T4: Update tests

**What**: Add/update tests:
- `test/classifier.test.ts`: add test cases for new patterns — TR-01 (git→fast), TR-02 (busca→fast), TR-06 (spec→heavy), TR-07 (task→heavy), TR-08 (regra→heavy)
- `test/selector.test.ts`: add test cases for classifyByLexicon with new stems — TR-11 (FAST_STEMS com git), TR-12 (HEAVY_STEMS com spec/task)
- Test TR-13 (múltiplos tiers: "buscar e refatorar" → medium because refatorar is checked first)
- Update `buildSelectorPrompt` test if one exists

**Where**: `test/classifier.test.ts`, `test/selector.test.ts`
**Depends on**: T1, T2, T3
**Reuses**: Existing test patterns

**Done when**:
- [ ] classifier.test.ts has tests for all new patterns
- [ ] selector.test.ts has tests for new stems
- [ ] `npx vitest run` passes with expected test count
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

**Tests**: unit
**Gate**: full (`npm run typecheck && npx vitest run && npm run lint`)
