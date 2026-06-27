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
- **Decision**: Enforcement is advisory-only (banners), never hard-block
- **Reason**: Plugins should never crash or block the user's session. Subagents see `[cap: 3/8]` and `[⚠ REDUNDANT]` banners in tool outputs — strong nudge, no hard error. Hard-block mode is opt-in for advanced users.
- **Trade-off**: A misbehaving model can ignore banners. In practice, the banners work because they appear inside tool output text that the model reads as ground truth.
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

## Handoff

- **Feature**: opencode-tier-router
- **Phase / Task**: —
- **Completed**: T1 (9b340e0), T2 (94ab478), T3 (bdf51ab), T4 (7c32b52), T5 (3217243), T6 (52f9ce7), T7 (91b0aef)
- **In-progress** (file:line): —
- **Next step**: Run Verifier for feature-level validation
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: master
