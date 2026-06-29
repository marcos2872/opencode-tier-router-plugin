# STATE

## Decisions

### AD-001
- **Decision**: Implement model routing as an OpenCode plugin, not a standalone agent or external proxy
- **Reason**: Plugins hook directly into `chat.system.transform` and `tool.execute` with ~210 token overhead, zero infra, and no external dependencies. A dedicated agent would add latency and cost per routing decision.
- **Trade-off**: Plugin runs inside OpenCode process — bugs can affect the host. Mitigation: all hooks are wrapped in try/catch with best-effort semantics.
- **Scope**: entire project
- **Date**: 2026-06-26
- **Status**: active

### AD-002
- **Decision**: Single `tiers.json` config file, no state persistence, no provider presets
- **Reason**: OpenCode is already multi-provider — model strings like `anthropic/claude-sonnet-4-5` carry provider info. Presets are redundant. State persistence adds complexity without value; mode changes rewrite `tiers.json` directly.
- **Trade-off**: Mode changes require filesystem write. Simpler to reason about and debug — one file is the whole truth.
- **Scope**: entire project
- **Date**: 2026-06-26
- **Status**: active

### AD-003
- **Decision**: Routing is prompt-based (orchestrator reads protocol), not a separate router model
- **Reason**: The orchestrator (ex: Sonnet) reads a ~210 token compact protocol and delegates via `Task()` tool. No fine-tuning, no second model call. The paper (Agent-as-a-Router) shows information > reasoning — the protocol gives the orchestrator the info it needs.
- **Trade-off**: No learned routing policy. Good enough: the reference implementation (opencode-model-router) proves this works with up to 83% cost reduction.
- **Scope**: routing logic
- **Date**: 2026-06-26
- **Status**: active

### AD-004
- **Decision**: Enforcement defaults to hard-block with `trivialDirectAllowed=false`; advisory remains available via config
- **Reason**: Real sessions showed advisory-only drift (wrong agent/model despite hints). Hard-block by default increases deterministic delegation and cost control.
- **Trade-off**: Stricter default can interrupt direct tool execution until delegation occurs. Mitigation: users can switch to advisory mode when they prefer direct execution.
- **Scope**: enforcement layer
- **Date**: 2026-06-26
- **Status**: active

### AD-005
- **Decision**: Config resolution uses layered strategy: project-local tiers.json overrides global
- **Reason**: Users commonly run OpenCode in different repos with different providers/budget preferences. A global default avoids boilerplate (no need to create tiers.json in every project), while a local override lets each project customize. Same pattern as OpenCode's own `opencode.json` resolution (project overrides global).
- **Trade-off**: Slightly more complex path resolution; need to decide where to CREATE tiers.json when none exists (answer: always in the project directory so it's visible and editable).
- **Scope**: config loading
- **Date**: 2026-06-26
- **Status**: active

## Implementation Summary — code-quality-refactor

**Status**: ✅ **COMPLETED AND VERIFIED (PASS)**

All 17 tasks across 4 phases implemented and verified on branch `feat/code-quality-refactor`.

### Results

| Metric | Before | After | Target | Status |
|--------|--------|-------|--------|--------|
| index.ts lines | 572 | 119 | ≤250 | ✅ (-79%) |
| Type safety (`as any`) | 1 occurrence | 0 | 0 | ✅ |
| Code duplication (costRatio) | 2 locations | 0 | 0 | ✅ |
| JSDoc coverage | ~10% | 100% public APIs | 100% | ✅ |
| Regex caching | recompiled per call | module-level cache | cached | ✅ |
| LRU touchLRU complexity | O(n) filter | O(1) Map ops | O(1) | ✅ |
| Race condition tests | 0 | 7 tests | present | ✅ |
| Test count | 307 | 314 | ≥300 | ✅ |
| Critical bugs | 2 | 0 | 0 | ✅ |

### New files created
- `src/plugin-orchestrator.ts` — Hook orchestration (SRP extraction)
- `src/router/cost-calculator.ts` — Centralized cost calculation
- `src/constants.ts` — Named constants
- `src/utils/safe-json.ts` — Safe JSON parsing with size limit
- `CONTRIBUTING.md` — Contribution guidelines
- `test/race-conditions.spec.ts` — Concurrent access tests

### 16 commits (b77c9af…79e5430)

## Handoff

### Completed
- **Remove global `input.permission` overrides** — hard-block is now prompt-based (`buildHardBlockMessage`). Tested in real session (121 tests pass).
- **`/router off` command** — handled in both `command.execute.before` and `chat.message` with `pendingCommandResponses` mechanism.
- **RTT-001 Real Token Cost Tracking** — Completed and verified (PASS)
- **code-quality-refactor** — Completed and verified (PASS)

### In Progress
- **ALIGN-34 Subagent Protocol Injection** — Spec `spec.md` and `context.md` created.
  - Phase: Specify ✅
  - Branch: `main` (no implementation started)
  - Next step: Confirm specs → implement (Design skipped — Medium scope)

- **hardblock-tier-message** — Bug fix: toast + delegation message sempre mostram `@heavy` hardcoded.
  - Phase: Specify ✅ (spec.md + context.md created)
  - Branch: `main` (no implementation started)
  - Next step: Confirm specs → implement (Design skipped — <3 changes)

### Not Started / Pending
- **wiki-alignment** — Not started. `spec.md`, `context.md` and `tasks.md` exist, but no source/test/config changes have been implemented and `validation.md` is missing.
  - Status: draft / pending implementation.

## Implementation Timeline

- **FASE 0** (5 tasks, 5.5h): Corrigir 5 falhas críticas
  - FASE0-T1: Separate into 5 SRP modules (90m)
  - FASE0-T2: OrphanBuffer + retry 5s (60m)
  - FASE0-T3: Config thresholds (45m)
  - FASE0-T4: LRU + TTL + persist-on-evict (60m)
  - FASE0-T5: Cleanup + versionamento (60m)
  - **Next:** Comece com FASE0-T1 — é foundational para todo o resto

- **FASE 1-4** (14 tasks, 11.75h): Implementar feature (conforme design corrigido)
  - RTT-T1..T5: Event capture (4h)
  - RTT-T6..T8: Aggregation (2.5h)
  - RTT-T9..T12: Commands (3h)
  - RTT-T13..T14: Integration (1.75h)

- **Total**: 19 tasks, **16.75 horas** (vs 26.5h sem correções)

## Decision Log Update

### AD-006 (REVISED)
- **Decision**: Real Token Tracking + 5 Critical Fixes
- **Reason**: Heuristic estimates inaccurate; architecture had 5 critical design flaws causing data loss, invalid metrics, race conditions, and technical debt
- **Fixes Applied**:
  1. **ERRO-001**: Separate into 5 SRP modules (Clean Architecture)
  2. **ERRO-002**: OrphanBuffer + retry 5s (temporal coupling)
  3. **ERRO-003**: Config-driven thresholds (vs hardcoded)
  4. **ERRO-004**: LRU + TTL + persist-on-evict (data loss prevention)
  5. **ERRO-005**: Cleanup strategy + maxHistoryFiles (disk bounded)
- **Trade-off**: +5.5h for Fase 0 → -10h debugging post-MVP → net -4.5h total
- **Evidence**: Post-review architecture passes SOLID, Clean Code, DDD principles
- **Scope**: RTT-001 implementation
- **Date**: 2026-06-27 (post-review)
- **Status**: active

### AD-007
- **Decision**: `wiki-alignment` remains pending and unimplemented until P0 runtime bugs and the rest of its task list are completed
- **Reason**: `spec.md`, `context.md` and `tasks.md` exist, but no implementation work has been committed and `validation.md` was missing. Marking it as pending avoids implying acceptance or verification.
- **Trade-off**: The validation report is intentionally descriptive until actual changes are made.
- **Scope**: wiki-alignment feature validation
- **Date**: 2026-06-28
- **Status**: pending implementation

### AD-008
- **Decision**: SDK OpenCode (`createOpencode()` / `createOpencodeClient()`) is N/A for this plugin
- **Reason**: The plugin uses only OpenCode runtime hooks and does not instantiate SDK clients
- **Trade-off**: SDK-specific setup is out of scope; runtime hooks remain the integration boundary
- **Scope**: wiki-alignment N/A scope
- **Date**: 2026-06-28
- **Status**: active

### AD-009
- **Decision**: Skills de agentes (`SKILL.md`) is N/A for this plugin
- **Reason**: The plugin does not define agent skills; `tlc-spec-driven` is loaded by name via skill tool
- **Trade-off**: Agent skill registration is out of scope; runtime hooks remain the integration boundary
- **Scope**: wiki-alignment N/A scope
- **Date**: 2026-06-28
- **Status**: active

### AD-010
- **Decision**: Subagents passam a receber diretivas comportamentais injetadas no system prompt via `handleSystemTransform`
- **Reason**: O `buildDelegationProtocol` já instrui o orquestrador que *"subagents cannot delegate to other subagents"*, mas o subagente nunca recebe essa instrução — o `handleSystemTransform` retorna cedo sem injetar nada. A injeção direta de "não delegue, não pergunte sem necessidade" fecha um gap de consistência entre a instrução que o orquestrador recebe e a que o subagente recebe.
- **Trade-off**: Subagentes agora recebem conteúdo injetado pelo plugin (antes recebiam zero deste plugin). Custo: ~20 tokens adicionais por sessão de subagente. Risco: se o runtime mudar a ordem de resolução de system prompts, a diretiva pode ser sobrescrita.
- **Scope**: ALIGN-34 (subagent prompt injection)
- **Date**: 2026-06-29
- **Status**: active
- **Refines**: AD-003 — subagentes continuam sem receber prompts de **roteamento**, mas agora recebem diretivas comportamentais
