# Hardblock Tool Intercept — Context

**Gathered:** 2026-06-29
**Spec:** `.specs/features/hardblock-tool-intercept/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Corrigir o bloqueio de ferramentas em sessões hard-blocked substituindo a
tentativa atual (ineficaz) de `output.allow = false` pela interceptação de
`output.args`, redirecionando ferramentas nativas para exibir a mensagem de
delegação.

---

## Implementation Decisions

### Por que `output.allow` não funciona

O tipo oficial do OpenCode para `tool.execute.before`:

```ts
"tool.execute.before"?: (input: {...}, output: { args: any }) => Promise<void>;
```

O output tem apenas `args`. Propriedades extras como `allow` e `message` são
ignoradas pelo runtime. O código atual (`plugin-orchestrator.ts:889-892`) seta
`output.allow = false` e `output.message = ...` sem efeito real.

### Abordagem: redirect via args

Em vez de tentar bloquear, **redirecionar** a ferramenta para que seu output
seja a mensagem de delegação:

| Ferramenta | Estratégia |
|---|---|
| `bash` | `command` → `echo "Delegue para @{tier}..."` |
| `read` | `filePath` → arquivo temporário com mensagem |
| `grep` | `pattern`/`include` → busca no arquivo temporário |
| `glob` | `pattern` → match do arquivo temporário |
| `list` | `path` → diretório do arquivo temporário |
| `edit`/`write` | `filePath` → `/dev/null` (no-op) |

### Arquivo temporário

- Local: `/tmp/opencode-router-model/{sessionID}.md`
- Criado em `handleChatMessage` quando hard-block é ativado
- Conteúdo: `buildHardBlockDelegationMessage(tier)`
- Limpeza: removido no `clearSessionRouterState` ou no próximo hard-block

### Locais exatos das mudanças

| Arquivo | Mudança |
|---------|---------|
| `src/plugin-orchestrator.ts` | Criar método privado `ensureDelegationFile(sessionID, tier)` |
| `src/plugin-orchestrator.ts` | Modificar `handleToolExecuteBefore` (~linha 883-892): substituir `allow=false`/`message` por redirect de args |
| `src/plugin-orchestrator.ts` | Criar método `redirectToolArgs(tool, args, tier)` com switch por ferramenta |
| `src/plugin-orchestrator.ts` | Chamar `ensureDelegationFile` no `handleChatMessage` quando hard-block é ativado (linha 629) |
| `src/constants.ts` | Adicionar `DELEGATION_TMP_DIR = '/tmp/opencode-router-model'` |

### Testes

- Atualizar testes que esperam `{ allow: false, message: ... }` para verificar args modificados
- Adicionar testes para cada ferramenta (bash, read, grep, glob, list, edit, write)
- Testar que subagentes não são afetados

---

## Agent's Discretion

- O nome exato do método de redirect (ex: `redirectToolArgs` vs `neutralizeTool`)
- A estrutura do arquivo temporário (apenas texto puro ou markdown)
- Se `ensureDelegationFile` atualiza o arquivo quando o tier muda na mesma sessão

---

## Specific References

- `node_modules/@opencode-ai/plugin/dist/index.d.ts:235-241` — Tipo oficial de `tool.execute.before`
- `src/plugin-orchestrator.ts:883-892` — Código atual que seta `allow=false` (ignorado)
- `src/plugin-orchestrator.ts:875-876` — `tier` e `decision` já disponíveis
- `src/prompts.ts:54-56` — `buildHardBlockDelegationMessage(tier)`

---

## Deferred Ideas

- Limpeza periódica de arquivos órfãos no /tmp
- Estatísticas de interceptação (quantas vezes cada ferramenta foi redirect)
