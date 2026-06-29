# opencode-tier-router-plugin

Plugin para OpenCode que roteia tarefas entre tiers de modelo: `@fast`, `@medium` e `@heavy`.

Objetivo: manter a qualidade das respostas e delegar trabalho ao modelo mais adequado, sem infraestrutura externa. O plugin roda como plugin do OpenCode, usando hooks de runtime para classificar a tarefa, injetar contexto no prompt e aplicar enforcement.

## Principais recursos

- Roteamento por tier com classificação por palavras-chave e, opcionalmente, por selector LLM.
- Enforcement configurável: `advisory` para orientação ou `hard-block` para exigir delegação.
- Mapeamento de agentes nativos: `explore -> @fast`, `build -> @medium`, `general -> @heavy`, `plan -> @heavy`.
- Persistência simples de modo via `tiers.json`; sem arquivo de estado separado.
- Caps e redundância para chamadas somente leitura em subagentes.
- Hooks de plugin integrados ao runtime OpenCode.
- Subagents não recebem prompts do router e não podem delegar para outros subagents.
- Padrões de classificação expandidos: comandos git e perguntas → @fast, correção/build → @medium, specs/tasks/regras → @heavy.

## Visão geral

O fluxo atual é:

1. Carrega `tiers.json` pelo projeto, fallback global ou defaults internos.
2. Registra os agents/tiers no hook `config`.
3. Classifica mensagens do chat por `taskPatterns`, lexicon simples e, se configurado, por selector LLM.
4. Injeta no prompt do sistema:
   - protocolo informativo de delegação quando não está em hard-block;
   - mensagem forte de hard-block quando `enforcement.mode = "hard-block"`.
5. Aplica fallback de enforcement via `permission.ask`, `event` e `tool.execute.before` para sessões principais bloqueadas — ferramentas nativas têm seus argumentos redirecionados para exibir a mensagem de delegação ao modelo.
6. Permite subagents executarem diretamente, mas impede subagents de chamarem `task()`.
7. Rastreia caps e chamadas redundantes para ferramentas somente leitura.
8. Preserva estado de router em compactação de sessão.

## Instalação

### Pré-requisitos

- Node.js 18+
- OpenCode com suporte a plugins
- Dependências do projeto instaladas localmente

### Build

```bash
npm install
npm run build
```

A saída principal fica em `dist/index.js`, indicada também por `"main": "dist/index.js"` no `package.json`.

### Como ativar no OpenCode

No `opencode.json` do projeto onde você vai usar:

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model"
  ]
}
```

Alternativa apontando diretamente para o build:

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model/dist/index.js"
  ]
}
```

Depois, reinicie a sessão do OpenCode e confirme:

```text
/router
/tiers
```

## Configuração (`tiers.json`)

### Ordem de resolução

1. `./tiers.json` no diretório atual do projeto, quando existe.
2. `~/.config/opencode/tiers.json` global, quando não há arquivo local.
3. Defaults internos do plugin, quando não há arquivo em nenhum lugar.

A função de resolução retorna o caminho local do projeto quando nenhum arquivo existe, para que comandos como `/budget` possam criar e persistir `tiers.json` no projeto.

### Exemplo atual

```json
{
  "mode": "normal",
  "tiers": {
    "fast": {
      "model": "opencode/big-pickle",
      "costRatio": 1,
      "cap": 8,
      "thresholds": {
        "min": 0,
        "max": 2000
      }
    },
    "medium": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 5,
      "cap": 12,
      "thresholds": {
        "min": 2000,
        "max": 10000
      }
    },
    "heavy": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 20,
      "cap": 20,
      "thresholds": {
        "min": 10000,
        "max": null
      }
    }
  },
  "modes": {
    "normal": {
      "description": "Balanced routing: fast for search, medium for implementation, heavy for architecture/debug",
      "defaultTier": "medium"
    },
    "budget": {
      "description": "Cost-first: prefer @fast whenever possible",
      "defaultTier": "fast"
    },
    "quality": {
      "description": "Quality-first: prefer @medium and @heavy over @fast",
      "defaultTier": "medium"
    },
    "deep": {
      "description": "Depth-first: route architecture and debug tasks to @heavy",
      "defaultTier": "heavy"
    }
  },
  "taskPatterns": {
    "fast": ["find", "grep", "search", "where", "locate", "list", "show", "read", "explore", "buscar", "busque", "busca", "procurar", "procure", "procura", "ler", "leia", "listar", "liste", "mostrar", "mostre", "git", "branch", "commit", "log", "diff", "status", "push", "pull", "merge", "clone", "onde", "oque", "como", "qual", "pergunta", "duvida", "doubt", "arquivo", "diretorio", "pasta"],
    "medium": ["refactor", "implement", "add", "write", "fix", "update", "change", "create", "edit", "rename", "implementar", "refatorar", "adicionar", "corrigir", "atualizar", "criar", "editar", "renomear", "validar", "compilar", "compila", "build"],
    "heavy": ["design", "architecture", "debug", "complex", "explain", "reason", "analyze", "optimize", "quality", "review", "arquitetura", "depurar", "complexo", "analisar", "otimizar", "qualidade", "revisar", "diagnosticar", "spec", "specs", "task", "tasks", "tasks.md", "rule", "rules", "regra", "regras", "projeto", "planejar", "plan", "especificacao", "especificar"]
  },
  "enforcement": {
    "mode": "hard-block",
    "trivialDirectAllowed": false
  },
  "routing": {
    "strategy": "llm",
    "selectorModel": "opencode/big-pickle",
    "selectorTimeoutMs": 1200,
    "selectorMaxTokens": 16
  }
}
```

### Campos suportados

| Campo | Valores | Obrigatório | Observações |
|---|---|---:|---|
| `mode` | string | Sim | Modo ativo. Deve existir dentro de `modes`. |
| `tiers.<tier>.model` | `provider/model` | Sim | Modelo usado pelo tier. Validação é apenas de formato. |
| `tiers.<tier>.costRatio` | número > 0 | Sim | Sinal relativo de custo para escolha de tier. |
| `tiers.<tier>.cap` | número > 0 | Sim | Limite de chamadas somente leitura para banners/caps. |
| `tiers.<tier>.thresholds` | `{ min: number, max: number | null }` | Não | Limites opcionais de tokens para cada tier. |
| `modes.<mode>.description` | string | Não | Texto legível exibido em `/tiers`. |
| `modes.<mode>.defaultTier` | `fast`, `medium` ou `heavy` | Sim | Tier usado quando nenhuma classificação corresponde. |
| `taskPatterns.fast` | lista de strings | Sim | Keywords para `@fast`; não pode estar vazia. |
| `taskPatterns.medium` | lista de strings | Sim | Keywords para `@medium`; não pode estar vazia. |
| `taskPatterns.heavy` | lista de strings | Sim | Keywords para `@heavy`; não pode estar vazia. |
| `enforcement.mode` | `advisory` ou `hard-block` | Sim | Padrão do plugin fallback: `hard-block`. |
| `enforcement.trivialDirectAllowed` | boolean | Sim | Padrão do plugin fallback: `false`. |
| `routing.strategy` | `keyword` ou `llm` | Sim | Padrão do plugin fallback: `keyword`; o `tiers.json` atual usa `llm`. |
| `routing.selectorModel` | `provider/model` | Sim | Modelo usado quando `routing.strategy = "llm"`. |
| `routing.selectorTimeoutMs` | número > 0 | Sim | Timeout do selector LLM em milissegundos. |
| `routing.selectorMaxTokens` | número > 0 | Sim | Limite de tokens de saída do selector LLM. |

### Persistência

- `mode` é persistido em `tiers.json` quando usado o comando `/budget <normal|budget|quality|deep>`.
- Alterações manuais em `tiers.json` são aplicadas quando o plugin recarrega/reinicia.
- Estado de `router on/off`, caps, sessões hard-blockadas e tier preferido da sessão ficam em memória.
- `/router off` desativa os hooks de roteamento e limpa o estado de router da sessão; ele não remove prompts de system que já tenham sido injetados antes do comando.
- Não há arquivo de estado separado para o router.

## Opções possíveis

### Modos

- `normal`: balanceado; usa `@medium` como default.
- `budget`: custo primeiro; prefere `@fast` sempre que possível.
- `quality`: qualidade primeiro; prefere `@medium` e `@heavy` sobre `@fast`.
- `deep`: profundidade primeiro; envia arquitetura/debug para `@heavy` e usa `@heavy` como default.

### Enforcement

| Modo | Comportamento |
|---|---|
| `advisory` | Injeta protocolo informativo e hint de roteamento. Não bloqueia execução direta. |
| `hard-block` | Injeta prompt imperativo de hard-block e usa hooks de fallback para negar execução direta de ferramentas nativas na sessão principal. |

### Strategy

- `keyword`: classifica por `taskPatterns`, com fallback por lexicon e depois por `defaultTier`.
- `llm`: chama `session.prompt()` com `routing.selectorModel`; se falhar ou timeout, cai para keyword/lexicon/default.

## Comandos do plugin

Comandos realmente implementados no runtime:

| Comando | O que faz |
|---|---|
| `/tiers` | Mostra modo ativo, enforcement, strategy, mapeamento de agentes, tier preferido da sessão e tiers configurados. |
| `/budget` | Lista modos disponíveis e marca o modo ativo. |
| `/budget <normal|budget|quality|deep>` | Troca o modo ativo e salva `mode` em `tiers.json` no projeto. |
| `/router` | Mostra se o router está `on` ou `off` na sessão atual. |
| `/router on` | Ativa o router no estado em memória da sessão atual. |
| `/router off` | Desativa os hooks de roteamento, limpa o estado de hard-block/preferência/caps e permite reativar com `/router on`. Não remove prompts já injetados antes do comando. |

Ferramenta customizada disponível:

| Ferramenta | O que faz |
|---|---|
| `router_status` | Retorna JSON com `enabled`, `mode`, `tiers` e `hardBlockCount`. |

Não existem comandos slash `/mode`, `/enforcement`, `/trivialDirectAllowed`, `/strategy`, `/reset` ou `/config`; altere esses campos em `tiers.json` e reinicie/recarregue o plugin para aplicar mudanças.

## Advisory vs hard-block

### `advisory`

- Injeta protocolo informativo com tiers, custos, modo e regras.
- Injeta hint de roteamento quando um tier é pré-selecionado.
- Não bloqueia execução direta na janela principal.
- Útil quando você prefere que o modelo decida se executa diretamente ou delega.

### `hard-block`

- Injeta `buildHardBlockMessage` no prompt da sessão principal.
- Instrui o modelo a chamar `task` com `subagent_type` adequado e não executar ferramentas diretamente.
- Usa fallbacks de runtime: `permission.ask` nega permissão, `event` rejeita eventos de permissão, e `tool.execute.before` redireciona os argumentos das ferramentas nativas para exibir a mensagem de delegação ao modelo (já que `allow`/`message` são ignorados pela API do runtime).
- Adiciona hints de ferramenta via `tool.definition`, mas não substitui os hooks de permissão.
- Subagents não recebem prompts do router e continuam executando diretamente.
- Native tools do runtime não são controladas diretamente em todos os contextos: na sessão principal hard-blockada, ferramentas nativas têm seus argumentos redirecionados para mostrar a mensagem de delegação; em subagents, ferramentas nativas são permitidas e executam normalmente.

Com `enforcement.trivialDirectAllowed = false` (padrão), até tarefas rápidas e triviais devem ser delegadas para `@fast`.

## Exemplos rápidos de fluxo

1. Ver status:

```text
/router
/tiers
```

2. Alternar modo e persistir em `tiers.json`:

```text
/budget quality
```

3. Delegar busca simples:

```text
busque autenticação no projeto
```

Tende a `@fast` e deve ser delegado para o subagent de busca/leitura.

4. Delegar implementação:

```text
refatore a função de login
```

Tende a `@medium`.

5. Delegar arquitetura/debug:

```text
analise a arquitetura da API e proponha mudanças de qualidade
```

Tende a `@heavy`.

## Troubleshooting

### `Model not found`

Verifique com `/tiers` e ajuste `tiers.<tier>.model` em `tiers.json`. Depois reinicie/recarregue o plugin para aplicar o novo modelo.

### Não está delegando

- Confirme que `/router` está `on`.
- Confirme em `/tiers` que `enforcement.mode` é `hard-block`.
- Se estiver em `advisory`, lembre que ele só orienta e não bloqueia execução direta.
- Ajuste `taskPatterns` para o idioma e comandos reais do seu projeto.
- Lembre que o `tool.execute.before` do runtime do OpenCode **não** suporta `allow=false` — o bloqueio real é feito via redirect de args. Se você vir ferramentas executando apesar do toast de hard-block, confirme se está usando a versão mais recente do plugin (com `redirectToolArgs`).
- Se `routing.strategy` for `llm`, confirme se `routing.selectorModel` existe no provider OpenCode.

### Tarefas nativas foram bloqueadas

Na sessão principal com hard-block, isso é esperado. O fluxo correto é delegar para o tier indicado, por exemplo `@fast`, `@medium` ou `@heavy`.

### Mudanças em `tiers.json` não surtiram efeito

O plugin carrega a configuração no início da sessão/plugin. Edite `tiers.json` e reinicie ou recarregue o plugin. O comando `/budget` é a exceção para trocar `mode`, porque persiste e atualiza o modo em memória.

### Hard-block está bloqueando demais

Use `advisory` para modo consultivo ou altere `enforcement.trivialDirectAllowed` para `true` se quiser permitir tarefas triviais de `@fast` executarem diretamente na janela principal.

## Desenvolvimento

Comandos disponíveis:

```bash
npm install
npm run build
npm run typecheck
npx vitest run
npm run lint
npm run format
npm run precommit
```

Descrição:

- `npm run build`: compila TypeScript para `dist/index.js`.
- `npm run typecheck`: executa `tsc --noEmit` e `tsc --noEmit -p tsconfig.test.json`.
- `npx vitest run`: executa todos os testes.
- `npm run lint`: executa ESLint em `src/` e `test/`.
- `npm run format`: verifica formatação com Prettier em `src/` e `test/`.
- `npm run precommit`: executa typecheck, lint e format.

### Estrutura principal

#### Core

- `src/index.ts` — ponto de entrada do plugin, hooks e ferramenta `router_status`.
- `src/plugin-orchestrator.ts` — orquestra hooks, estado de sessão, hard-block, caps e compacts router state.
- `src/prompts.ts` — builders de protocolo informativo, hard-block, hint de roteamento e anotação de narração.
- `src/constants.ts` — constantes nomeadas para TTL, caps, custos e mensagens de hard-block.
- `src/narration.ts` — detecção de narração em saída de texto.

#### Roteamento, config e enforcement

- `src/router/config.ts` — carregamento, validação e persistência de modo em `tiers.json`.
- `src/router/selector.ts` — seleção por `keyword` ou `llm` com fallback.
- `src/router/classifier.ts` — classificação por palavras-chave.
- `src/router/permissions.ts` — matriz de permissões para `task`, ferramentas nativas e customizadas.
- `src/router/caps.ts` — cap tracker e detecção de chamadas somente leitura redundantes.
- `src/router/enforcement-validator.ts` — validação, assertiva e relatório de enforcement.
- `src/router/types.ts` — tipos de estado preservado em compacts.

#### Utilitários

- `src/utils/logger.ts` — `FileLogger`, grava logs em `router-debug.log`.
- `src/utils/safe-json.ts` — parsing JSON seguro com limite de tamanho.

#### Testes

- `test/phase0-modules.spec.ts`
- `test/enforcement-validator.spec.ts`
- `test/phase2-persistence.spec.ts`
- `test/phase4-e2e.spec.ts`
- `test/phase5-plugin-integration.spec.ts`
- `test/protocol.test.ts`
- `test/caps.test.ts`
- `test/config-thresholds.spec.ts`
- `test/index.test.ts`
- `test/lru-eviction.spec.ts`
- `test/race-conditions.spec.ts`

## Licença

MIT
