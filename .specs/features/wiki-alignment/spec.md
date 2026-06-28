# Wiki Alignment Specification

## Problem Statement

Validação contra duas wikis de referência revelou 23 gaps no plugin:

1. **WIKI.md** (repositório `opencode-plugin-wiki`): 15 discrepâncias arquiteturais — contexto parcial, falta de observabilidade, dependência não declarada, hooks ausentes (`shell.env`, `session.compacting`, `tool.execute.before`), blocking via mecanismo não-preferencial, comandos sem template pattern, sem ferramentas customizadas, sem `.opencode/tools/`, sem matriz de permissões, sem notificações, logging estruturado incompleto, SDK e Skills não declarados como fora-de-escopo
2. **Testing Wiki** (diretrizes internas do projeto): 13 gaps em 9 arquivos de teste — AAA ausente, import order incorreto, mocks manuais, cobertura de erro faltando, nomes em inglês, describe names com prefixo de categoria, `toThrow` sem mensagem, comentários de bloco ruidosos, spy lifecycle incorreto
3. **Validação de código**: 3 bugs/gaps — `/budget` não recarrega config em memória, subagentes com `task: 'allow'`, `console.warn` em vez de FileLogger

## Goals

- [ ] Fix all runtime bugs (config reload, subagent delegation, terminal logging)
- [ ] Align all code with WIKI.md architectural expectations
- [ ] Align all test files with Testing Wiki guidelines

---

## Priority Stack (execution order)

| Priority | Area | Tasks | Descrição |
| -------- | ---- | ----- | --------- |
| **P0** | Runtime bugs | 5 | Config reload, subagent task, console.warn, peer dep, context |
| **P1** | Observability + Blocking + Permissions | 5 | client.app.log + logging hierarchy, tool.execute.before detailed contract, notificações, matriz de permissões |
| **P2** | Session lifecycle | 2 | shell.env detailed contract, session.compacting detailed contract |
| **P3** | Test alignment | 9 | 9 test files → AAA, import order, PT-BR, vi.spyOn, etc |
| **P4** | Polish + N/A scope | 6 | .opencode/commands, .opencode/tools/, router_status, tool normalization, tsconfig, SDK/Skills N/A |

---

## Requirement Traceability

| ID | Área | Descrição | Prio | Fonte |
| -- | ---- | --------- | ---- | ----- |
| ALIGN-01 | Source | Fix config reload after `/budget` | P0 | enforcement-gaps |
| ALIGN-02 | Source | Add test for config reload | P0 | enforcement-gaps |
| ALIGN-03 | Source | Remove `task: 'allow'` from subagents | P0 | enforcement-gaps |
| ALIGN-04 | Source | Replace `console.warn` with FileLogger | P0 | enforcement-gaps |
| ALIGN-05 | Config | Add `@opencode-ai/sdk` to peerDependencies | P0 | wiki-code-alignment |
| ALIGN-06 | Source | Expand PluginOrchestrator context (project, $, worktree) | P0 | wiki-code-alignment |
| ALIGN-07 | Source | Add `client.app.log()` for observability | P1 | wiki-code-alignment |
| ALIGN-08 | Source | Add `tool.execute.before` for hard-block blocking | P1 | wiki-code-alignment |
| ALIGN-09 | Source | Implement `shell.env` hook | P2 | wiki-code-alignment |
| ALIGN-10 | Source | Implement `experimental.session.compacting` | P2 | wiki-code-alignment |
| ALIGN-11..19 | Test | Align each of 9 test files with Testing Wiki | P3 | wiki-alignment |
| ALIGN-20 | Config | Create `.opencode/commands/` template files | P4 | wiki-code-alignment |
| ALIGN-21 | Source | Create `router_status` custom tool | P4 | wiki-code-alignment |
| ALIGN-22 | Source | Add `tool.execute.before` arg normalization for subagents | P4 | wiki-code-alignment |
| ALIGN-23 | Config | Update tsconfig.json module to NodeNext | P4 | wiki-code-alignment |
| ALIGN-24 | Source | Add `tool.execute.before` detailed contract (denied tool set, subagent exemption, sensitive-file protection semantics) | P1 | wiki-validation |
| ALIGN-25 | Source | Add `shell.env` detailed contract (hook payload/output, exact env vars list) | P2 | wiki-validation |
| ALIGN-26 | Source | Add `experimental.session.compacting` detailed contract (routing state fields to preserve) | P2 | wiki-validation |
| ALIGN-27 | Source | Establish logging hierarchy: `client.app.log()` primário, FileLogger secundário, zero `console.warn` | P1 | wiki-validation |
| ALIGN-28 | Source | Add notification support for blocked-tool and user-facing alerts via `client.tui.showToast()` | P1 | wiki-validation |
| ALIGN-29 | Source | Define permissions matrix (allow/ask/deny for primary session, hard-blocked session, subagent) | P1 | wiki-validation |
| ALIGN-30 | Config | Create `.opencode/tools/` directory with standalone `router_status` tool per wiki conventions | P4 | wiki-validation |
| ALIGN-31 | Docs | Mark SDK OpenCode (`createOpencode()`/`createOpencodeClient()`) as N/A — plugin uses runtime hooks only | P4 | wiki-validation |
| ALIGN-32 | Docs | Mark Skills de agentes (`SKILL.md`) as N/A — plugin does not define agent skills | P4 | wiki-validation |

---

## Success Criteria

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` passes with ≥ current test count
- [ ] `@opencode-ai/sdk` declared in peerDependencies
- [ ] No `console.warn` in `src/`; `client.app.log()` used at init, classification, hard-block, errors; FileLogger used for debug-only
- [ ] Subagents cannot delegate via `task()`
- [ ] `/budget <mode>` immediately affects routing
- [ ] `tool.execute.before` blocks only denied tools for hard-blocked main sessions; subagent sessions pass through; sensitive-file protection documented
- [ ] `shell.env` injects `OPENCODE_ROUTER_TIER`, `OPENCODE_ROUTER_MODE`, `OPENCODE_ROUTER_HARD_BLOCKED` into subagent shells
- [ ] `experimental.session.compacting` preserves `preferredTier`, `selectionSource`, `hardBlockedTier`, `hardBlockReason`
- [ ] Notifications sent for hard-blocked tool access via `client.tui.showToast()`
- [ ] Permissions matrix enforced: hard-blocked sessions deny tools, subagents deny `task()`, primary sessions allow all
- [ ] All test files follow AAA, PT-BR, import order, vi.spyOn patterns
- [ ] `.opencode/commands/tiers.md`, `budget.md`, `router.md` exist
- [ ] `.opencode/tools/` directory exists with standalone `router_status` tool
- [ ] SDK OpenCode explicitly marked N/A in docs
- [ ] Skills de agentes explicitly marked N/A in docs
