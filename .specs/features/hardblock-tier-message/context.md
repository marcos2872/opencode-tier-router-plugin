# Hardblock Tier Message Fix — Context

**Gathered:** 2026-06-29
**Spec:** `.specs/features/hardblock-tier-message/spec.md`
**Status:** Ready for implementation

---

## Feature Boundary

Corrigir dois locais onde o nome do tier está hardcoded como `@heavy` na
notificação de hard-block, e adicionar `touchSession()` para subagentes.

---

## Implementation Decisions

### `HARD_BLOCK_DELEGATION_MESSAGE` vira função

- **Decisão:** Criar `buildHardBlockDelegationMessage(tier: string): string` em
  `src/prompts.ts` (junto dos outros builders), remover a constante de
  `src/constants.ts`, e importar a função onde for usada.
- **Motivo:** O padrão do projeto é usar funções builder para strings dinâmicas
  (`buildHardBlockMessage`, `buildDelegationProtocol`, `buildRoutingHint`).
  Constante não pode receber parâmetros.
- **Risco:** `HARD_BLOCK_DELEGATION_MESSAGE` é importada em
  `test/index.test.ts`. Testes precisam ser atualizados para chamar a função.

### `notifyToolBlocked` recebe `tier`

- **Decisão:** `notifyToolBlocked(tier: string): Promise<void>`.
- **Motivo:** A função precisa saber o tier para montar a mensagem.
- **Uso:** A chamada em `handleToolExecuteBefore` (linha 872) passa
  `tier` da linha 864.

### `touchSession` para subagentes

- **Decisão:** Adicionar `this.touchSession(input.sessionID)` no branch de
  subagente em `handleToolExecuteBefore` (linha 850).
- **Motivo:** A sessão do subagente faz diversas chamadas de ferramenta sem
  passar por `chat.message`. Sem o `touchSession`, o TTL de 30 minutos
  (`SESSION_TTL_MS`) pode expirar e a sessão ser removida de
  `subagentSessions` pelo `cleanupSessions()`.

### Locais exatos das mudanças

| Arquivo | Linha | Mudança |
|---------|-------|---------|
| `src/constants.ts` | 48-49 | Remover `HARD_BLOCK_DELEGATION_MESSAGE` |
| `src/prompts.ts` | — | Adicionar `buildHardBlockDelegationMessage(tier)` |
| `src/plugin-orchestrator.ts` | 224-240 | `notifyToolBlocked(tier)` com msg dinâmica |
| `src/plugin-orchestrator.ts` | 850 | Adicionar `this.touchSession(input.sessionID)` |
| `src/plugin-orchestrator.ts` | 872 | Passar `tier` para `notifyToolBlocked(tier)` |
| `src/plugin-orchestrator.ts` | 881 | Usar `buildHardBlockDelegationMessage(tier)` |
| `src/index.ts` | — | Nenhuma mudança necessária (não usa a constante) |
| `test/index.test.ts` | vários | Atualizar imports/asserts para nova função |

---

## Agent's Discretion

- **Nome exato da função:** `buildHardBlockDelegationMessage` vs
  `buildBlockedToolMessage`. Seguir o padrão `build*Message` dos builders
  existentes.
- **Testes:** Ajustar os testes existentes que referenciam
  `HARD_BLOCK_DELEGATION_MESSAGE` para usar a nova função com `tier = "heavy"`
  (compatibilidade retroativa).

---

## Specific References

- `src/constants.ts:48-49` — `HARD_BLOCK_DELEGATION_MESSAGE` hardcoded
- `src/plugin-orchestrator.ts:224-240` — `notifyToolBlocked()` hardcoded
- `src/plugin-orchestrator.ts:864-881` — `handleToolExecuteBefore` chamando ambos
- `src/plugin-orchestrator.ts:850-861` — Branch de subagente sem `touchSession`

---

## Deferred Ideas

- Adicionar o tier no título do toast (`"Acao bloqueada (@medium)"`) — melhoria
  cosmética adicional, não necessária para o bug.
