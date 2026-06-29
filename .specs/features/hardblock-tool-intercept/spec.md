# Hardblock Tool Intercept — Redirect blocked tools to delegation message

## Problem Statement

O plugin tenta bloquear ferramentas nativas (grep, read, bash, etc.) em sessões
hard-blocked via `tool.execute.before` com `output.allow = false` e
`output.message = buildHardBlockDelegationMessage(tier)`. Porém, o tipo oficial
do OpenCode para este hook é:

```ts
"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => Promise<void>;
```

O output **só tem `args`** — `allow` e `message` não existem na API. O runtime
ignora essas propriedades, e a ferramenta executa normalmente. O toast aparece
(mensagem correta) mas a ferramenta roda e retorna resultado.

## Goals

- [ ] Ferramentas bloqueadas retornam a mensagem de delegação ao modelo, não o resultado real
- [ ] Mensagem de delegação inclui o tier correto (fast/medium/heavy)
- [ ] `bash` redireciona para echo com a mensagem de delegação
- [ ] `grep`/`read`/`glob`/`list` redirecionam para arquivo temporário com a mensagem
- [ ] `edit`/`write` são redirecionados para no-op (/dev/null)
- [ ] Subagentes não são afetados (continuam com ferramentas normais)

## Out of Scope

| Item | Razão |
| ---- | ----- |
| Alterar o mecanismo de hard-block (classificação) | Escopo separado — tier-reclassification |
| Adicionar logs ou métricas de interceptação | Pode ser adicionado depois se necessário |
| Limpeza de arquivos temporários entre sessões | Gerenciado pelo TTL de sessão |

---

## User Stories

### P1: Bash interceptado com mensagem de delegação ⭐ MVP

**User Story**: Como um modelo hard-blocked, quando tento usar `bash`, quero ver a
mensagem de delegação no output para entender que preciso delegar.

**Acceptance Criteria**:

1. **HBTI-01** — WHEN `handleToolExecuteBefore` bloqueia `bash` em sessão hard-blocked
   com `tier = "medium"` THEN `output.args.command` SHALL ser
   `echo "Delegue para @medium. Esta ferramenta esta bloqueada para execucao direta."`

2. **HBTI-02** — WHEN `handleToolExecuteBefore` bloqueia `bash` em sessão hard-blocked
   com `tier = "fast"` THEN `output.args.command` SHALL conter `@fast`

### P2: Read interceptado com arquivo de delegação ⭐ MVP

**Acceptance Criteria**:

3. **HBTI-03** — WHEN `handleToolExecuteBefore` bloqueia `read` em sessão hard-blocked
   THEN `output.args.filePath` SHALL apontar para um arquivo temporário que contém
   a mensagem de delegação com o tier correto

### P3: Grep interceptado com arquivo de delegação

**Acceptance Criteria**:

4. **HBTI-04** — WHEN `handleToolExecuteBefore` bloqueia `grep` em sessão hard-blocked
   THEN `output.args.include` e `output.args.pattern` SHALL ser ajustados para buscar
   no arquivo temporário de delegação

### P4: Glob interceptado

**Acceptance Criteria**:

5. **HBTI-05** — WHEN `handleToolExecuteBefore` bloqueia `glob` em sessão hard-blocked
   THEN `output.args.pattern` SHALL ser ajustado para corresponder apenas ao arquivo
   temporário de delegação

### P5: List interceptado

**Acceptance Criteria**:

6. **HBTI-06** — WHEN `handleToolExecuteBefore` bloqueia `list` em sessão hard-blocked
   THEN `output.args.path` SHALL apontar para o diretório do arquivo temporário

### P6: Edit/Write interceptados

**Acceptance Criteria**:

7. **HBTI-07** — WHEN `handleToolExecuteBefore` bloqueia `edit` ou `write` em sessão
   hard-blocked THEN `output.args.filePath` SHALL ser `/dev/null`

### Subagentes não afetados

8. **HBTI-08** — WHEN `handleToolExecuteBefore` é chamado para sessão de subagente
   THEN os `args` NÃO SHALL ser modificados (comportamento atual preservado)

---

## Edge Cases

9. **HBTI-09** — WHEN o diretório temporário `/tmp/opencode-router-model/` não existe
   THEN o plugin SHALL criá-lo antes de escrever o arquivo de delegação

10. **HBTI-10** — WHEN `output.args` é `undefined` THEN o plugin SHALL inicializá-lo
    antes de modificar propriedades (sem crash)

11. **HBTI-11** — WHEN a sessão não está hard-blocked THEN os args NÃO SHALL ser
    modificados (fluxo normal preservado)

12. **HBTI-12** — WHEN a ferramenta bloqueada não tem `args` no output (ex: bash sem
    `command` definido) THEN o plugin SHALL inicializar os args necessários

---

## Requirement Traceability

| ID | Story | Description | Status |
|----|-------|-------------|-------|
| HBTI-01 | P1: Bash | command redirecionado para echo com tier medium | Pending |
| HBTI-02 | P1: Bash | command redirecionado para echo com tier fast | Pending |
| HBTI-03 | P2: Read | filePath aponta para arquivo de delegação | Pending |
| HBTI-04 | P3: Grep | include/pattern ajustados | Pending |
| HBTI-05 | P4: Glob | pattern ajustado | Pending |
| HBTI-06 | P5: List | path ajustado | Pending |
| HBTI-07 | P6: Edit/Write | filePath = /dev/null | Pending |
| HBTI-08 | Subagentes | Args não modificados | Pending |
| HBTI-09 | Edge | Diretório temporário criado | Pending |
| HBTI-10 | Edge | Args undefined inicializado | Pending |
| HBTI-11 | Edge | Sessão não hard-blocked preservada | Pending |
| HBTI-12 | Edge | Args sem propriedades inicializado | Pending |

**Coverage:** 12 total, 0 mapped to tasks, 12 unmapped ⚠️

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|-----------------------|----------------|-----------|------------|
| Arquivo temporário por sessão | `/tmp/opencode-router-model/{sessionID}.md` | Cada sessão tem seu tier; evita race conditions | N |
| Arquivo criado em `handleChatMessage` | Quando hard-block é ativado | Tier já está disponível; arquivo pronto para intercept | N |
| Mensagem exata no arquivo | `Delegue para @{tier}. Esta ferramenta esta bloqueada para execucao direta.` | Mesmo texto do `buildHardBlockDelegationMessage` | N |
| Diretório temporário fixo | `/tmp/opencode-router-model/` | Padrão POSIX; não precisa de permissão especial | N |

---

## Success Criteria

- [ ] `npm run typecheck` passa sem erros
- [ ] `npx vitest run` passa (testes existentes + novos)
- [ ] `npm run lint` passa sem novos warnings
- [ ] Teste manual: sessão hard-blocked tenta grep/read/bash e recebe mensagem de delegação
