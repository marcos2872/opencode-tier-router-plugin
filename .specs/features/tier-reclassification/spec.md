# Tier Reclassification — Alinhar padrões com o fluxo de trabalho do usuário

## Problem Statement

A classificação atual de tiers não reflete o fluxo de trabalho real do usuário:

- Consultas de **busca e git** (ex: "buscar se precisa atualizar as docs", "git log",
  "onde está o arquivo X") são classificadas como `@medium` ou `@heavy` porque
  palavras como "atualizar" no meio da frase disparam padrões de tiers mais altos
- O seletor LLM usa descrições genéricas em inglês que não capturam intenções em
  português ou comandos git
- Existem **dois sistemas de classificação** com lógicas diferentes: `classifyByPattern`
  (word-boundary, tiers.json) e `classifyByLexicon` (stem counting, selector.ts),
  com ordens de precedência divergentes

## Goals

- [ ] Consultas de busca/leitura/git são classificadas como `@fast`
- [ ] Consultas de correção/build/refatoração são classificadas como `@medium`
- [ ] Consultas de arquitetura/specs/tasks/regras são classificadas como `@heavy`
- [ ] Padrões em português são cobertos em todos os tiers
- [ ] Seletor LLM (buildSelectorPrompt) reflete a mesma categorização
- [ ] Stems do `classifyByLexicon` (selector.ts) estão alinhados com `taskPatterns`

## Out of Scope

| Item | Razão |
| ---- | ----- |
| Alterar a estratégia de routing (llm vs keyword) | Pode ser feita separadamente |
| Adicionar novos tiers | Apenas reclassificar padrões existentes |
| Modificar o algoritmo de matching (word-boundary vs stem) | O algoritmo está correto; só os padrões precisam mudar |

---

## User Stories

### P1: Busca e git são @fast ⭐ MVP

**User Story**: Como um usuário, quero que consultas de busca, leitura e git sejam
delegadas para `@fast` (modelo mais barato e rápido).

**Acceptance Criteria**:

1. **TR-01** — WHEN o texto da consulta contém palavras de busca (buscar, procurar,
   localizar, search, find, grep, where, list) THEN `classifyByPattern` SHALL
   retornar `"fast"`

2. **TR-02** — WHEN o texto da consulta contém palavras de git (git, branch, commit,
   log, diff, status, push, pull, merge, clone) THEN `classifyByPattern` SHALL
   retornar `"fast"`

3. **TR-03** — WHEN o texto da consulta contém palavras de pergunta sobre arquivos
   (onde, oque, como, qual, que, what, where, how, doubt, duvida) combinadas com
   palavras de arquivo (arquivo, file, diretorio, directory, função, class, arquivo)
   THEN `classifyByPattern` SHALL retornar `"fast"`

### P2: Correção, build e refatoração são @medium ⭐ MVP

**Acceptance Criteria**:

4. **TR-04** — WHEN o texto da consulta contém palavras de correção/build (fix,
   corrigir, build, compilar, compila, refactor, refatorar) THEN `classifyByPattern`
   SHALL retornar `"medium"`

5. **TR-05** — WHEN o texto da consulta contém palavras de implementação (implement,
   implementar, add, adicionar, write, escrever, create, criar, edit, editar,
   update, atualizar, change, alterar, rename, renomear) MAS NÃO contém palavras
   de busca/git THEN `classifyByPattern` SHALL retornar `"medium"`

### P3: Arquitetura, specs, tasks e regras são @heavy ⭐ MVP

**Acceptance Criteria**:

6. **TR-06** — WHEN o texto da consulta contém palavras de arquitetura (architecture,
   arquitetura, design, sistema, system, estrutura, structure) THEN
   `classifyByPattern` SHALL retornar `"heavy"`

7. **TR-07** — WHEN o texto da consulta contém palavras de especificação (spec,
   specs, especificação, especificar, spec.md, context.md, tasks.md) THEN
   `classifyByPattern` SHALL retornar `"heavy"`

8. **TR-08** — WHEN o texto da consulta contém palavras de regras/tasks (task,
   tasks.md, rules, regras, rule, projeto, projeto, planejar, plan) THEN
   `classifyByPattern` SHALL retornar `"heavy"`

### P4: Seletor LLM alinhado

**Acceptance Criteria**:

9. **TR-09** — WHEN `buildSelectorPrompt` é construída THEN a descrição de `fast`
   SHALL incluir "search", "read", "list", "git", "buscar", "listar", "mostrar"

10. **TR-10** — WHEN `buildSelectorPrompt` é construída THEN a descrição de `heavy`
    SHALL incluir "architecture", "design", "specs", "rules", "tasks", "arquitetura",
    "especificacao", "regras"

### P5: Stems do classifyByLexicon alinhados

**Acceptance Criteria**:

11. **TR-11** — WHEN `classifyByLexicon` é chamado THEN `FAST_STEMS` SHALL conter
    stems de git (git, branch, commit, log, diff, status)

12. **TR-12** — WHEN `classifyByLexicon` é chamado THEN `HEAVY_STEMS` SHALL conter
    stems de especificação (spec, task, rule, regr, projet, planej)

---

## Edge Cases

13. **TR-13** — WHEN a consulta contém palavras de múltiplos tiers (ex: "buscar e
    refatorar") THEN `classifyByPattern` SHALL usar a ordem heavy→medium→fast
    (comportamento atual preservado)

14. **TR-14** — WHEN `classifyByLexicon` recebe empate entre tiers THEN a lógica
    atual (heavy ≥ medium ≥ fast) SHALL be mantida

---

## Requirement Traceability

| ID | Story | Description | Status |
|----|-------|-------------|--------|
| TR-01 | P1: Busca | Palavras de busca → fast | Pending |
| TR-02 | P1: Git | Palavras de git → fast | Pending |
| TR-03 | P1: Perguntas | Perguntas sobre arquivos → fast | Pending |
| TR-04 | P2: Correção | Fix/build → medium | Pending |
| TR-05 | P2: Implementação | Implementação → medium | Pending |
| TR-06 | P3: Arquitetura | Arquitetura/design → heavy | Pending |
| TR-07 | P3: Specs | Especificação/spec → heavy | Pending |
| TR-08 | P3: Regras | Tasks/rules/regras → heavy | Pending |
| TR-09 | P4: LLM | buildSelectorPrompt com fast expandido | Pending |
| TR-10 | P4: LLM | buildSelectorPrompt com heavy expandido | Pending |
| TR-11 | P5: Stems | FAST_STEMS com git | Pending |
| TR-12 | P5: Stems | HEAVY_STEMS com spec/task | Pending |
| TR-13 | Edge | Múltiplos tiers | Pending |
| TR-14 | Edge | Empate no lexicon | Pending |

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped ⚠️

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|-----------------------|----------------|-----------|------------|
| Ordem de verificação heavy→medium→fast | Mantida | Comportamento existente preservado | Y |
| `classifyByPattern` vs `classifyByLexicon` | Ambos atualizados | Fallback do LLM usa ambos; consistência necessária | N |
| Padrões git no fast | git, branch, commit, log, diff, status | Principais comandos git usados no dia-a-dia | N |

---

## Success Criteria

- [ ] `npm run typecheck` passa sem erros
- [ ] `npx vitest run` passa (testes existentes + novos)
- [ ] `npm run lint` passa sem novos warnings
- [ ] Classificação manual: "buscar se precisa atualizar as docs" → @fast
- [ ] Classificação manual: "git log" → @fast
- [ ] Classificação manual: "refatorar modulo de auth" → @medium
- [ ] Classificação manual: "criar spec para nova feature" → @heavy
