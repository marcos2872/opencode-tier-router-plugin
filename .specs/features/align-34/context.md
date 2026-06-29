# ALIGN-34: Subagent Protocol Injection — Context

**Gathered:** 2026-06-29
**Spec:** `.specs/features/align-34/spec.md`
**Status:** Ready for implementation

---

## Feature Boundary

Injetar um bloco de diretivas comportamentais no prompt de sistema de sessões de
subagente, instruindo-os a (1) não delegar sub-tarefas e (2) não perguntar ao usuário
a menos que estejam bloqueados. A injeção ocorre em `handleSystemTransform`, que
atualmente retorna cedo sem injetar nada para subagentes.

---

## Implementation Decisions

### Nome da função builder

- **Decisão:** `buildSubagentDirectives()` em `src/prompts.ts`
- **Motivo:** O nome `buildSubagentProtocol` (proposto na task original) é genérico e
  pode causar confusão com `buildDelegationProtocol`. O sufixo `Directives` deixa claro
  que são instruções comportamentais, não um protocolo de roteamento.
- **Risco baixo** — nome puramente cosmético, fácil de mudar.

### Wording da diretiva

- **Decisão:** Usar exatamente:
  ```
  Do not dispatch sub-sub-agents. Do not ask the user questions unless blocked.
  ```
- **Motivo:** A primeira frase alinha com o `buildDelegationProtocol` existente
  (`prompts.ts:82`: *"Subagents cannot delegate to other subagents"*). A segunda frase
  cobre o caso de perguntas desnecessárias.
- **Alternativa considerada:** Versão mais verbosa ("You are a subagent. Execute
  everything yourself. Do not call `task`...") — rejeitada por ser mais prolixa sem
  ganho de clareza.

### Uma função vs duas

- **Decisão:** Uma única função retornando uma string com ambas as frases.
- **Motivo:** As duas diretivas são sempre injetadas juntas. Separar em duas funções
  adicionaria complexidade sem benefício — ambas entrariam no mesmo `output.system.push()`.
- **Mudança futura:** Se um dia houver necessidade de injetar apenas uma delas, a
  função pode ser fatorada.

### Local da injeção em handleSystemTransform

- **Decisão:** Substituir o `return` vazio na linha 647 por:
  ```ts
  if (input.sessionID && this.subagentSessions.has(input.sessionID)) {
    output.system = output.system ?? [];
    output.system.push(buildSubagentDirectives());
    return;
  }
  ```
- **Motivo:** A checagem já existe e está posicionada corretamente — antes dos blocos
  de hard-block/routing. O `return` continua impedindo que prompts de roteamento ou
  hard-block cheguem ao subagente.
- **Nota:** Essa mudança altera o comportamento documentado em AD-003 (*"Subagents
  receive no router prompts"*). A ressalva passa a ser: subagentes não recebem prompts
  de **roteamento**, mas recebem diretivas comportamentais.

### Tratamento de output.system undefined

- **Decisão:** `output.system = output.system ?? []` antes do push.
- **Motivo:** O runtime pode chamar o hook sem inicializar `output.system`. O padrão
  já é usado nos blocos subsequentes (linha 650). Seguir o mesmo padrão.

---

## Agent's Discretion

- **Formatação do bloco:** Se será uma linha única, um bloco Markdown, ou apenas texto
  puro — decisão do implementador, desde que o conteúdo seja o especificado.
- **Teste de unidade:** O implementador decide o nível de cobertura (mínimo: um teste
  que verifica a presença das frases no output de subagente, e um que verifica ausência
  em sessão principal).

---

## Declined / Undiscussed Gray Areas → Assumptions

| Gray area | Default | Rationale |
|-----------|---------|-----------|
| E se o subagente precisar delegar por design? | Não é permitido | Subagentes são workers, não orquestradores. Se um subagente precisar delegar, a feature deveria estar na sessão principal. |

---

## Specific References

- `src/prompts.ts:82` — `buildDelegationProtocol` já contém *"Subagents cannot delegate
  to other subagents — only the main session can delegate."*
- `src/plugin-orchestrator.ts:647` — Early return para subagentes, que será modificado
- `src/plugin-orchestrator.ts:553` — Onde `subagentSessions` é populado no hook
  `chat.message`

---

## Deferred Ideas

Nenhuma — discussão ficou dentro do escopo da feature.
