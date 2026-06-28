# opencode-tier-router-plugin

🚀 **Plugin para OpenCode** que faz **roteamento inteligente por tiers de modelo** (`@fast`, `@medium`, `@heavy`) com base no tipo de tarefa.

Objetivo: manter a qualidade das respostas e delegar trabalho ao modelo mais adequado, sem infraestrutura externa (proxy/router separado).

## ✨ Principais Recursos

- 🎯 **Roteamento por tier**: Classifica automaticamente e delega para o modelo mais adequado
- 🔒 **Hard-block enforcement**: Bloqueio real de ferramentas via `permission.ask` + `event` hook, com toast de notificação
- ⚡ **Caps & redundância**: Monitora uso de leitura e detecta trabalho redundante
- 🧩 **Plugin hooks**: Integração nativa com OpenCode via hooks existentes
- 🚫 **Sem corrente de delegação**: Subagentes não podem delegar para outros subagentes — executam diretamente

---

## Visão geral

O plugin:

1. Lê a configuração de `tiers.json`
2. Injeta um protocolo de delegação no system prompt
3. Classifica tarefas por palavras-chave (`taskPatterns`)
4. Aplica fallback de seleção (`llm -> keyword -> defaultTier`)
5. Aplica controles de uso (caps e redundância) em subagentes
6. Aplica enforcement para exigir delegação

Também mapeia agentes nativos do OpenCode para tiers:

- `explore -> @fast`
- `build -> @medium`
- `general -> @heavy`
- `plan -> @heavy`

---

## Instalação

### Pré-requisitos

- Node.js 18+
- OpenCode com suporte a plugins

### Build

```bash
npm install
npm run build
```

Saída principal: `dist/index.js`

### Como ativar no OpenCode

No `opencode.json` do projeto onde você vai usar:

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model"
  ]
}
```

Alternativa (apontando para build):

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model/dist/index.js"
  ]
}
```

Depois, reinicie a sessão e rode:

```text
/tiers
```

---

## Configuração (`tiers.json`)

Ordem de resolução:

1. `./tiers.json` (projeto atual)
2. `~/.config/opencode/tiers.json` (global)
3. defaults internos do plugin

### Exemplo completo

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
      "description": "Balanced routing",
      "defaultTier": "medium"
    },
    "budget": {
      "description": "Cost-first",
      "defaultTier": "fast"
    },
    "quality": {
      "description": "Quality-first",
      "defaultTier": "medium"
    },
    "deep": {
      "description": "Depth-first",
      "defaultTier": "heavy"
    }
  },
  "taskPatterns": {
    "fast": ["find", "grep", "search", "read", "list", "buscar", "busque", "procurar", "procure", "ler", "leia", "listar", "liste"],
    "medium": ["implement", "refactor", "fix", "update", "create", "implementar", "refatorar", "corrigir", "atualizar", "criar", "validar"],
    "heavy": ["design", "architecture", "debug", "analyze", "quality", "review", "arquitetura", "depurar", "analisar", "qualidade", "revisar"]
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

---

## Opções possíveis

| Campo | Valores | Efeito |
|---|---|---|
| `mode` | `normal`, `budget`, `quality`, `deep` | Seleciona perfil de roteamento |
| `tiers.<tier>.model` | `provider/model` | Modelo usado no tier |
| `tiers.<tier>.costRatio` | número > 0 | Sinal de custo para decisão |
| `tiers.<tier>.cap` | número > 0 | Limite de leitura para banners/cap |
| `tiers.<tier>.thresholds` | `{min, max}` | Limites de inputTokens para classificação automática |
| `taskPatterns` | lista de keywords | Classificação por intenção |
| `enforcement.mode` | `advisory`, `hard-block` | Advisory só orienta; hard-block nega execução direta quando necessário |
| `enforcement.trivialDirectAllowed` | `true`, `false` | Em hard-block, permite/bloqueia tarefas triviais |
| `routing.strategy` | `keyword`, `llm` | Seleção de tier por keyword ou por modelo rápido |
| `routing.selectorModel` | `provider/model` | Modelo usado para seleção quando `strategy=llm` |
| `routing.selectorTimeoutMs` | número > 0 | Timeout da seleção LLM |
| `routing.selectorMaxTokens` | número > 0 | Limite de tokens para resposta do selector |

---

## Comandos do plugin

### Roteamento & Configuração

| Comando | O que faz |
|---|---|
| `/tiers` | Mostra configuração ativa (modo, enforcement, tiers e mapeamento de agentes) |
| `/budget` | Lista modos disponíveis |
| `/budget <mode>` | Troca modo e atualiza `tiers.json` |
| `/router` | Mostra status do plugin (`on/off`) |
| `/router on` | Liga o roteador |
| `/router off` | Desliga o roteador |

---

## Advisory vs Hard-block

### `advisory`

- Injeta protocolo de delegação
- Não bloqueia execução direta
- Melhor para fluxo padrão

### `hard-block`

- Força delegação via **prompt** — `buildHardBlockMessage` injeta instruções imperativas no system prompt:
  "YOUR FIRST AND ONLY ACTION: Call task. ALL TOOLS EXCEPT 'task' ARE PERMANENTLY DENIED."
- Hooks `permission.ask` e `event` atuam como fallback para ferramentas que o runtime considera sensíveis
- Native tools (`read`, `edit`, `glob`, `grep`, etc.) são auto-allowed pelo runtime
- Com `trivialDirectAllowed=false` (padrão), **toda** tarefa precisa delegar
- Com `trivialDirectAllowed=true`, tarefas triviais fast podem executar direto

---

## Exemplos rápidos

- Busca simples (tende a `@fast`):
  - `busque autenticação no projeto`
- Implementação/refactor (tende a `@medium`):
  - `refatore a função de login`
- Arquitetura/debug/análise (tende a `@heavy`):
  - `analyze code quality and propose architecture changes`

---

## Troubleshooting

## 1) `Model not found`

O ID do modelo está inválido para seu provider. Verifique com `/models` e ajuste `tiers.json`.

## 2) Não está delegando

- Verifique `/tiers`
- Ajuste `taskPatterns` para seu idioma/prompt real
- Teste `enforcement.mode = "hard-block"`

## 3) Delega, mas mantém modelo errado

Confirme em `/tiers` o mapeamento de agentes nativos (`explore/build/general/plan`) e os modelos de tiers.

## 4) Aviso de `tiers.json` ausente

Ausência de `tiers.json` é tratada com fallback de defaults. Para controle total, crie `tiers.json` no projeto.

---

## Desenvolvimento

```bash
npm run build
npm run typecheck
npx vitest run
```

Estrutura principal:

### Core

- `src/index.ts` → hooks e comandos do plugin (config, chat.message, system.transform, permission.ask, event, tool.definition, tool.execute.after, command.execute.before)
- `src/plugin-orchestrator.ts` → orquestração de hooks (SRP extraction)
- `src/prompts.ts` → prompt builders (protocolo info, hard-block, routing hint)
- `src/constants.ts` → constantes nomeadas (FALLBACK_CONFIG, regex, SESSION_TTL)
- `src/narration.ts` → detecção de narração

### Roteamento & Delegação

- `src/router/config.ts` → load/validate/save de config
- `src/router/classifier.ts` → classificação de tarefas por keywords
- `src/router/selector.ts` → seletor de tier (keyword/LLM + fallback)
- `src/router/caps.ts` → cap tracker + redundância + cleanup por sessão
- `src/router/enforcement-validator.ts` → validação de enforcement

### Utilitários

- `src/utils/logger.ts` → FileLogger (router-debug.log)
- `src/utils/safe-json.ts` → parsing JSON seguro

### Testes

- `test/phase0-modules.spec.ts` → testes SRP
- `test/enforcement-validator.spec.ts` → testes de validação de enforcement
- `test/phase2-persistence.spec.ts` → testes de persistência e carregamento
- `test/phase4-e2e.spec.ts` → testes de ciclo completo
- `test/phase5-plugin-integration.spec.ts` → testes de integração plugin
- `test/caps.test.ts` → testes de cap tracker
- `test/config-thresholds.spec.ts` → testes de thresholds de configuração
- `test/index.test.ts` → testes de integração do index
- `test/lru-eviction.spec.ts` → testes de LRU eviction
- `test/race-conditions.spec.ts` → testes de acesso concorrente
- `ENFORCEMENT.md` → rules, architecture guarantees, security checklist

---

## Licença

MIT
