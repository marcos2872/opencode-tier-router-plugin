# Hardblock Tier Message Fix

## Problem Statement

Quando uma sessão principal é hard-blockada e tenta usar uma ferramenta nativa
(`read`, `bash`, `edit`, etc.), o plugin:

1. Exibe um **toast** com `"Delegue para @heavy."` — sempre `@heavy`,
   independente do tier real (ex: `@medium` ou `@fast`)
2. Retorna uma **mensagem de bloqueio** com `"Delegue para @heavy. Esta ferramenta
   esta bloqueada para execucao direta."` — também sempre `@heavy`

Isso é enganoso: o usuário/modelo tenta delegar para `@heavy` quando o tier correto
é outro, ou ignora a instrução por ela estar errada.

## Goals

- [ ] Toast de bloqueio mostra o tier correto (ex: "Delegue para @medium.")
- [ ] Mensagem de bloqueio (`output.message`) mostra o tier correto
- [ ] Testes existentes que usam `HARD_BLOCK_DELEGATION_MESSAGE` continuam passando
- [ ] `touchSession()` é chamado para sessões de subagente ativas

## Out of Scope

| Item | Razão |
| ---- | ----- |
| Alterar o comportamento de hard-block (quando/quem bloqueia) | Fora do escopo — o mecanismo está correto |
| Alterar o prompt HARD-BLOCK (`buildHardBlockMessage`) | Escopo separado, não menciona tiers no título |
| Adicionar notificações para outros eventos | Apenas corrigir mensagens existentes |

---

## Acceptance Criteria

### BUG-01: Toast `notifyToolBlocked` mostra tier correto

1. **HBTM-01** — WHEN `notifyToolBlocked()` é chamada com `tier = "medium"`
   THEN o toast SHALL conter `"Delegue para @medium."`

2. **HBTM-02** — WHEN `notifyToolBlocked()` é chamada com `tier = "fast"`
   THEN o toast SHALL conter `"Delegue para @fast."`

3. **HBTM-03** — WHEN `notifyToolBlocked()` é chamada com `tier = "heavy"`
   THEN o toast SHALL conter `"Delegue para @heavy."` (mantém comportamento atual)

### BUG-02: `HARD_BLOCK_DELEGATION_MESSAGE` mostra tier correto

4. **HBTM-04** — WHEN `handleToolExecuteBefore` bloqueia uma ferramenta com
   hard-block `tier = "fast"` THEN `output.message` SHALL conter
   `"Delegue para @fast."`

5. **HBTM-05** — WHEN `handleToolExecuteBefore` bloqueia uma ferramenta com
   hard-block `tier = "heavy"` THEN `output.message` SHALL conter
   `"Delegue para @heavy."`

### BUG-03: `touchSession` para subagentes ativos

6. **HBTM-06** — WHEN `handleToolExecuteBefore` é chamado para uma sessão de
   subagente THEN `touchSession(input.sessionID)` SHALL ser chamado

### Compatibilidade

7. **HBTM-07** — WHEN `handleToolExecuteBefore` bloqueia uma ferramenta com
   hard-block `tier = "heavy"` THEN `output.message` SHALL terminar com
   `"Esta ferramenta esta bloqueada para execucao direta."` (sufixo preservado)

8. **HBTM-08** — WHEN `handleToolExecuteBefore` bloqueia uma ferramenta com
   hard-block `tier = "heavy"` THEN `output.allow` SHALL ser `false`
   (comportamento de bloqueio inalterado)

---

## Requirement Traceability

| ID | Story | Description | Status |
|----|-------|-------------|--------|
| HBTM-01 | BUG-01 | Toast mostra tier medium | Pending |
| HBTM-02 | BUG-01 | Toast mostra tier fast | Pending |
| HBTM-03 | BUG-01 | Toast mostra tier heavy (regressão) | Pending |
| HBTM-04 | BUG-02 | Mensagem bloqueio mostra tier fast | Pending |
| HBTM-05 | BUG-02 | Mensagem bloqueio mostra tier heavy (regressão) | Pending |
| HBTM-06 | BUG-03 | touchSession chamado para subagentes | Pending |
| HBTM-07 | Compat | Sufixo da mensagem preservado | Pending |
| HBTM-08 | Compat | output.allow = false preservado | Pending |

**Coverage:** 8 total, 0 mapped to tasks, 8 unmapped ⚠️

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|-----------------------|----------------|-----------|------------|
| `HARD_BLOCK_DELEGATION_MESSAGE` vira função | `buildHardBlockDelegationMessage(tier: string)` | Constante não pode ser dinâmica; função é o padrão do projeto (ex: `buildHardBlockMessage`) | N |
| `notifyToolBlocked` recebe tier como parâmetro | `notifyToolBlocked(tier: string)` | Única forma de saber o tier real no momento da chamada | N |
| Testes que usam `HARD_BLOCK_DELEGATION_MESSAGE` | Atualizar para chamar a nova função | Evita quebra de compatibilidade | Y |

**Open questions:** Nenhuma.

---

## Success Criteria

- [ ] `npm run typecheck` passa
- [ ] `npx vitest run` passa (incluindo testes atualizados)
- [ ] `npm run lint` passa
