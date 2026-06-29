# ALIGN-34: Subagent Protocol Injection

## Problem Statement

O protocolo de delegação da sessão principal (`buildDelegationProtocol`) já instrui o
orquestrador com *"Subagents cannot delegate to other subagents"* (`prompts.ts:82`), mas
essa instrução **nunca chega ao subagente** — o hook `handleSystemTransform` retorna cedo
na linha 647 sem injetar nada para sessões de subagente.

Como resultado, subagentes podem:
- Tentar delegar sub-tarefas via `task()`, desperdiçando contexto e custo
- Perguntar ao usuário questões desnecessárias em vez de executar diretamente

Esta feature adiciona um bloco de diretivas comportamentais ao prompt do subagente para
fechar esse gap.

## Goals

- [ ] Subagentes recebem instrução explícita para não delegar sub-tarefas
- [ ] Subagentes recebem instrução para limitar perguntas ao usuário
- [ ] Sessões principais não são afetadas
- [ ] Comportamento existente de hard-block/routing permanece intacto

## Out of Scope

| Item | Razão |
| ---- | ----- |
| Alterar permissões de ferramentas dos subagentes | Já são controladas por `handlePermissionAsk` e `handleEvent` |
| Alterar o protocolo de delegação da sessão principal (`buildDelegationProtocol`) | Escopo separado, já implementado |
| Adicionar configuração para habilitar/desabilitar a injeção | Sem necessidade identificada — a diretiva é sempre desejável |
| Alterar o comportamento de `handleSystemTransform` para sessões não-subagente | Fora do escopo — mudanças só no branch de subagente |

---

## User Stories

### P1: Subagente recebe diretiva "não delegar" ⭐ MVP

**User Story**: Como um subagente, quero receber a instrução de não delegar sub-tarefas
para que eu execute o trabalho diretamente sem desperdiçar contexto com delegação
recursiva.

**Why P1**: Gap de consistência — a sessão principal já sabe que subagentes não delegam,
mas o subagente não. Sem isso, subagentes podem tentar `task()` e ser negados ou,
pior, criar cadeias de delegação não intencionais.

**Acceptance Criteria**:

1. **ALIGN-01** — WHEN uma sessão de subagente dispara `experimental.chat.system.transform`
   THEN o `output.system` SHALL conter o texto `Do not dispatch sub-sub-agents`

2. **ALIGN-03** — WHEN uma sessão de subagente dispara `experimental.chat.system.transform`
   THEN a diretiva SHALL ser **adicionada** ao prompt existente (append, não replace)

3. **ALIGN-04** — WHEN uma sessão **principal** (não subagente) dispara
   `experimental.chat.system.transform` THEN o `output.system` SHALL **NOT** conter a
   diretiva de subagente

4. **ALIGN-05** — WHEN uma sessão principal em modo hard-block dispara
   `experimental.chat.system.transform` THEN o prompt existente de hard-block
   (`buildHardBlockMessage`) SHALL continuar sendo injetado intacto

**Independent Test**: Disparar `experimental.chat.system.transform` para uma sessão de
subagente (registrada via `chat.message` com agent=`fast`/`medium`/`heavy`) e verificar
que o output contém a diretiva. Repetir para sessão principal e verificar que NÃO contém.

---

### P1: Subagente recebe diretiva "não perguntar sem necessidade" ⭐ MVP

**User Story**: Como um subagente, quero receber a instrução de não perguntar ao usuário
a menos que esteja bloqueado, para que eu execute tarefas de forma autônoma.

**Why P1**: Subagentes devem operar de forma headless. Perguntas ao usuário quebram o
fluxo e exigem intervenção manual.

**Acceptance Criteria**:

5. **ALIGN-02** — WHEN uma sessão de subagente dispara `experimental.chat.system.transform`
   THEN o `output.system` SHALL conter o texto `Do not ask the user questions unless blocked`

**Independent Test**: Mesmo setup do P1 anterior — verificar que ambas as frases estão
presentes no output.

---

## Edge Cases

6. **ALIGN-06** — WHEN uma sessão de subagente dispara `experimental.chat.system.transform`
   com `output.system === undefined` THEN o plugin SHALL inicializar `output.system` como
   `[]` antes de fazer o push da diretiva (sem crash)

7. **ALIGN-07** — WHEN `input.sessionID` é `undefined` THEN o plugin SHALL pular a
   checagem de subagente (sem crash, sem TypeError)

---

## Requirement Traceability

| ID | Story | Description | Status |
|----|-------|-------------|--------|
| ALIGN-01 | P1: Não delegar | Subagente recebe "Do not dispatch sub-sub-agents" | Pending |
| ALIGN-02 | P1: Não perguntar | Subagente recebe "Do not ask the user questions unless blocked" | Pending |
| ALIGN-03 | P1: Não delegar | Diretiva é adicionada (append), não substitui | Pending |
| ALIGN-04 | P1: Não delegar | Sessão principal não recebe a diretiva | Pending |
| ALIGN-05 | P1: Não delegar | Hard-block existente permanece intacto | Pending |
| ALIGN-06 | Edge cases | output.system undefined é inicializado | Pending |
| ALIGN-07 | Edge cases | sessionID undefined é seguro | Pending |

**Coverage:** 7 total, 0 mapped to tasks, 7 unmapped ⚠️

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|-----------------------|----------------|-----------|------------|
| Função para construir a diretiva | `buildSubagentDirectives()` em `prompts.ts` | Nome mais descritivo que `buildSubagentProtocol`; evita confusão com `buildDelegationProtocol` | N |
| Texto exato da diretiva | `Do not dispatch sub-sub-agents. Do not ask the user questions unless blocked.` | Alinhado com o wording do `buildDelegationProtocol` (prompts.ts:82) | N |
| Uma função vs duas | Uma função com ambas as frases | São sempre injetadas juntas; separar adicionaria complexidade sem ganho | N |
| Subagentes já registrados via `chat.message` | Mesmo mecanismo existente (`this.subagentSessions`) | Nenhuma mudança necessária no registro | Y |

**Open questions:** Nenhuma — todas resolvidas ou registradas como assumptions acima.

---

## Success Criteria

- [ ] `npm run typecheck` passa sem erros
- [ ] `npx vitest run` passa (testes existentes + novos)
- [ ] `npm run lint` passa sem novos warnings
- [ ] Subagente real (simulado em teste) recebe ambas as diretivas
