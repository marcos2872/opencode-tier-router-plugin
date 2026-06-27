# opencode-tier-router Specification

## Problem Statement

OpenCode users typically run one model for every task — paying Opus prices to run `grep`. This is 3-10x overpayment because ~40% of coding work is exploration/search (which a cheap model handles fine), ~45% is implementation (mid-tier), and only ~15% needs the expensive frontier model. There is no lightweight, zero-infrastructure plugin that automatically routes each task to the cheapest adequate model.

## Goals

- [ ] Reduce cost by ~80% on exploration/search tasks by routing them to @fast tier (1x cost)
- [ ] Reduce cost by ~50% on implementation tasks by routing them to @medium tier (5x cost)
- [ ] Zero new infrastructure — plugin-only, ~210 token overhead per message
- [ ] Subagents respect read-only call caps to prevent reconnaissance loops
- [ ] User can disable/enable the plugin at runtime without restart

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| External proxy / gateway | Weave Router approach requires infra; plugin-only is the constraint |
| Fine-tuned router model | Paper uses Qwen3.5-0.8B; prompt-based routing is sufficient for MVP |
| Persistent vector store / Memory | Adds embeddings dependency; keyword classification is good enough |
| Hard-block enabled by default | Too risky for default UX — hard-block remains opt-in |
| Cross-session budget tracking | Stateless by design; each session starts fresh |
| Provider fallback chains | OpenCode already handles provider failover natively |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Test framework | vitest | Reference implementation uses vitest; Bun-native compatible | y |
| Plugin language | TypeScript | OpenCode plugins are TypeScript-first; type safety for hook contracts | y |
| Config format | JSON (tiers.json) | Simple, parseable, no dependencies | y |
| Mode persistence | Rewrites tiers.json.mode field | Single source of truth; no separate state file | y |
| Three tiers only | fast / medium / heavy | Matches paper and reference; more tiers would overcomplicate | y |
| Default models (GitHub Copilot) | @fast=github-copilot/claude-haiku-4.5, @medium=github-copilot/gpt-5.3-codex, @heavy=github-copilot/claude-sonnet-4.5 | GitHub Copilot users don't need extra API keys; models are familiar from Copilot ecosystem | y |
| Cost ratios | 1x / 5x / 20x | Directional signal for orchestrator; user-tunable | y |
| Default mode | normal | Balanced; user switches via /budget | y |
| Enforcement mode | advisory by default, optional hard-block | Safe default + strict mode for advanced users | y |
| Fallback behavior | Orquestrador executa diretamente se subagente falhar | Fail-safe: nunca perder a tarefa | y |
| Concurrency | Hooks podem ser chamados concorrentemente; cada sessão tem seu tracker | Plugin stores são criados por instância (closure) | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Automatic Model Tier Delegation ⭐ MVP

**User Story**: As a developer using OpenCode, I want the orchestrator to automatically delegate tasks to the cheapest adequate model tier so that I stop overpaying for simple operations like grep and file reads.

**Why P1**: Core value proposition — without delegation, there's no cost saving.

**Acceptance Criteria**:

1. WHEN the user asks a search/exploration task (e.g., "find where X is defined") THEN the orchestrator SHALL delegate to the @fast tier instead of executing directly
2. WHEN the user asks an implementation task (e.g., "refactor this function") THEN the orchestrator SHALL delegate to the @medium tier
3. WHEN the user asks an architecture/debug task (e.g., "design the auth module") THEN the orchestrator SHALL delegate to the @heavy tier
4. WHEN the user asks a trivial task (≤1 tool call, no expected follow-up) THEN the orchestrator SHALL execute directly without delegation overhead

**Independent Test**: Run OpenCode with plugin, type "grep for authenticate function" — verify via /tiers output and session log that a @fast subagent is dispatched.

---

### P2: Configurable Tier Models ⭐ MVP

**User Story**: As a developer, I want to configure which model runs each tier so that I can adapt routing to my preferred providers and budget.

**Why P2**: Without configuration, the plugin is tied to one provider's models.

**Acceptance Criteria**:

1. WHEN the user edits `tiers.json` and changes a tier's model field THEN the plugin SHALL use the new model for that tier on the next message
2. WHEN a tier's model string is invalid (e.g., nonexistent provider) THEN the plugin SHALL skip that tier and log a warning without crashing
3. WHEN the user runs `/tiers` THEN the plugin SHALL display the active tier configuration (model, cost ratio, cap)

**Independent Test**: Edit tiers.json to swap @fast to a different model, send a grep query, verify the subagent uses the new model.

---

### P3: Cap Enforcement + Redundancy Detection

**User Story**: As a developer, I want subagents to stop reading after a reasonable number of calls and to detect redundant reads so that I don't waste tokens on reconnaissance loops.

**Why P3**: Prevents the #1 token-waste pattern in agentic coding.

**Acceptance Criteria**:

1. WHEN a @fast subagent makes more than 8 read-only tool calls (grep/read/glob/ls) THEN subsequent tool results SHALL include a `[⚠ CAP REACHED (N/8)]` banner
2. WHEN a subagent repeats the exact same grep or file read THEN the result SHALL include a `[⚠ REDUNDANT: this is the same X you ran at call #N]` banner
3. WHEN a subagent is at 4/8 calls THEN results SHALL include a `[cap: 4/8]` counter banner
4. WHEN cap is reached AND the subagent makes another read call THEN the banner SHALL escalate to `[⚠ CAP WARNING: N remaining]` and finally `[⚠ CAP REACHED]`

**Independent Test**: Trigger a @fast subagent with a query that requires 10+ reads — verify banners appear after call 8.

---

### P4: Routing Mode Switching (/budget)

**User Story**: As a developer, I want to switch between routing modes (normal, budget, quality, deep) so that I can control cost vs quality at runtime.

**Why P4**: Gives user control without editing JSON.

**Acceptance Criteria**:

1. WHEN the user types `/budget` THEN the plugin SHALL list available modes with descriptions and the active mode highlighted
2. WHEN the user types `/budget budget` THEN the plugin SHALL switch to budget mode (default tier = @fast) and persist the change in `tiers.json`
3. WHEN the user types `/budget quality` THEN the plugin SHALL switch to quality mode (liberal @medium/@heavy)
4. WHEN the user types `/budget deep` THEN the plugin SHALL switch to deep mode (default @heavy for arch/debug)

**Independent Test**: Run `/budget budget`, send a medium-complexity task, verify it goes to @fast instead of @medium.

---

### P5: Narration Detection Guard

**User Story**: As a developer, I want the plugin to detect when Claude is narrating progress ("Still writing the X function...") instead of producing actual work, so that I can spot this known failure pattern.

**Why P5**: Catches a known Claude thinking-mode failure that wastes tokens and produces no output.

**Acceptance Criteria**:

1. WHEN a completed message contains patterns like "Still writing the X" or "Now I'll implement Y" THEN the plugin SHALL append `[⚠ narration detected: "..."]` to the message
2. WHEN the message is clean (no narration patterns) THEN the plugin SHALL NOT modify the message

**Independent Test**: Force a Claude model into thinking mode with a complex task — verify banner appears if narration occurs.

---

### P6: Redundancy Prevention

**User Story**: As a developer, I want to avoid repeated reads of the same file or repeated grep patterns so that each tool call adds new information.

**Why P6**: Reduces token waste on repeated reconnaissance.

**Acceptance Criteria**:

1. WHEN a subagent reads the same file twice THEN the second result SHALL include `[⚠ REDUNDANT]` banner
2. WHEN a subagent runs the same grep pattern twice THEN the second result SHALL include `[⚠ REDUNDANT]` banner
3. WHEN a subagent reads different files or runs different grep patterns THEN no redundancy banner SHALL appear

**Independent Test**: Send a subagent to investigate a function — if it re-reads the same file, verify the banner appears.

---

### P7: Plugin Toggle (/router on|off)

**User Story**: As a developer, I want to disable the router temporarily (e.g., to debug a model-specific issue) and re-enable it without restarting OpenCode.

**Why P7**: Users need an escape hatch — if routing causes unexpected behavior, they can fall back to their default model instantly.

**Acceptance Criteria**:

1. WHEN the user types `/router off` THEN the plugin SHALL stop injecting the delegation protocol and stop tracking caps/narration — all messages go directly to the default model
2. WHEN the user types `/router on` THEN the plugin SHALL resume normal routing operation
3. WHEN the user types `/router` with no arguments THEN the plugin SHALL display the current status (on or off)
4. WHEN the router is off THEN ALL hooks SHALL short-circuit with no side effects (zero overhead)

**Independent Test**: Run `/router off`, send a search query, verify no @fast subagent is dispatched (the main model handles it directly). Run `/router on`, send same query, verify @fast subagent is dispatched.

---

### P8: Enforcement Modes + Agent Mapping

**User Story**: As a developer, I want optional hard-block enforcement and deterministic mapping of built-in OpenCode agents to tiers so that delegation uses the expected model and direct execution can be blocked when strict routing is required.

**Why P8**: Advisory prompts alone are not always enough in real sessions; strict mode and agent mapping reduce routing drift.

**Acceptance Criteria**:

1. WHEN `enforcement.mode = "hard-block"` AND request is non-trivial THEN direct tool execution in the main session SHALL be denied and the protocol SHALL instruct delegation to the required tier
2. WHEN `enforcement.mode = "hard-block"` AND `trivialDirectAllowed = true` AND request is trivial fast THEN direct execution SHALL remain allowed
3. WHEN OpenCode delegates using built-in agents (`explore`, `build`, `general`, `plan`) THEN the plugin SHALL map them to tier models (`@fast`, `@medium`, `@heavy`, `@heavy`)
4. WHEN user runs `/tiers` THEN output SHALL include the active enforcement mode and built-in agent mapping summary

**Independent Test**: Set hard-block mode and request a non-trivial quality review — verify direct main-session tool calls are denied and delegation guidance is injected. In advisory mode, verify `build/explore` use mapped tier models.

---

## Edge Cases

- WHEN tiers.json is missing or malformed THEN the plugin SHALL log a warning and continue with hardcoded defaults
- WHEN all tier agents fail to dispatch THEN the orchestrator SHALL execute the task directly
- WHEN a user edits tiers.json while OpenCode is running THEN the plugin SHALL pick up changes on the next message (no hot-reload needed — re-read on each hook call)
- WHEN the model in a tier string is invalid THEN the tier SHALL be skipped with a logged warning, and the orchestrator SHALL fall back to direct execution
- WHEN /budget is called with an invalid mode name THEN the plugin SHALL show available modes and keep the current mode unchanged
- WHEN built-in agent `build` is selected THEN routing model SHALL map to `@medium` tier model
- WHEN hard-block is enabled and redirection fails THEN direct main-session tool execution SHALL be denied

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| RTR-01 | P1: Delegacao automatica | Tasks | ✅ Verified |
| RTR-02 | P1: Classificacao por keyword | Tasks | ✅ Verified |
| RTR-03 | P1: Execucao direta p/ trivial | Tasks | ✅ Verified |
| RTR-04 | P2: Config tiers.json | Tasks | ✅ Verified |
| RTR-05 | P2: Validacao de modelo | Tasks | ✅ Verified |
| RTR-06 | P2: Comando /tiers | Tasks | ✅ Verified |
| RTR-07 | P3: Cap banners | Tasks | ✅ Verified |
| RTR-08 | P3: Redundancy detection | Tasks | ✅ Verified |
| RTR-09 | P4: Comando /budget | Tasks | ✅ Verified |
| RTR-10 | P4: Persistencia de mode | Tasks | ✅ Verified |
| RTR-11 | P5: Narration detection | Tasks | ✅ Verified |
| RTR-12 | P5: Banner de narracao | Tasks | ✅ Verified |
| RTR-13 | EC: Config invalida | Tasks | ✅ Verified |
| RTR-14 | EC: Fallback direto | Tasks | ✅ Verified |
| RTR-15 | EC: Mode invalido | Tasks | ✅ Verified |
| RTR-16 | P7: Comando /router | Tasks | ✅ Verified |
| RTR-17 | P7: Plugin desligado (noop) | Tasks | ✅ Verified |
| RTR-18 | P8: Hard-block opt-in | Tasks | ✅ Verified |
| RTR-19 | P8: Agent mapping build/explore/general/plan | Tasks | ✅ Verified |

**ID format:** `RTR-[NUMBER]` (Router)

---

## Success Criteria

- [ ] User can install the plugin and see cost reduction on the first session (grep/read tasks hit @fast instead of the main model)
- [ ] User can configure tiers via `tiers.json` without reading code
- [ ] User can switch modes via `/budget` without editing files
- [ ] Subagents respect caps within ±1 call of the configured limit
- [ ] Zero crashes from plugin errors — all hooks are best-effort
- [ ] User can disable/re-enable the router at any time via `/router on|off`
