# opencode-tier-router

Plugin para OpenCode que faz **roteamento por tiers de modelo** (`@fast`, `@medium`, `@heavy`) com base no tipo de tarefa.

Objetivo: reduzir custo e manter qualidade, sem infra extra (proxy/router externo).

---

## Visão geral

O plugin:

1. Lê a configuração de `tiers.json`
2. Injeta um protocolo de delegação no system prompt
3. Classifica tarefas por palavras-chave (`taskPatterns`)
4. Direciona para tier adequado
5. Aplica controles de uso (caps e redundância) em subagentes

Também mapeia agentes nativos do OpenCode para tiers:

- `explore -> @fast`
- `build -> @medium`
- `general -> @heavy`
- `plan -> @heavy`

---

## Instalação

## Pré-requisitos

- Node.js 18+
- OpenCode com suporte a plugins

## Build

```bash
npm install
npm run build
```

Saída principal: `dist/index.js`

---

## Como ativar no OpenCode

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
      "model": "github-copilot/claude-haiku-4.5",
      "costRatio": 1,
      "cap": 8
    },
    "medium": {
      "model": "github-copilot/gpt-5.3-codex",
      "costRatio": 5,
      "cap": 12
    },
    "heavy": {
      "model": "github-copilot/claude-sonnet-4.5",
      "costRatio": 20,
      "cap": 20
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
    "fast": ["find", "grep", "search", "read", "list", "buscar", "procurar", "ler", "listar"],
    "medium": ["implement", "refactor", "fix", "update", "create", "implementar", "refatorar", "corrigir", "atualizar", "criar", "validar"],
    "heavy": ["design", "architecture", "debug", "analyze", "quality", "review", "arquitetura", "depurar", "analisar", "qualidade", "revisar"]
  },
  "enforcement": {
    "mode": "advisory",
    "trivialDirectAllowed": true
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
| `taskPatterns` | lista de keywords | Classificação por intenção |
| `enforcement.mode` | `advisory`, `hard-block` | Advisory só orienta; hard-block nega execução direta quando necessário |
| `enforcement.trivialDirectAllowed` | `true`, `false` | Em hard-block, permite/bloqueia tarefas triviais |

---

## Comandos do plugin

| Comando | O que faz |
|---|---|
| `/tiers` | Mostra configuração ativa (modo, enforcement, tiers e mapeamento de agentes) |
| `/budget` | Lista modos disponíveis |
| `/budget <mode>` | Troca modo e persiste em `tiers.json` |
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

- Tenta forçar delegação para tier correto
- Se sessão principal tentar executar tools direto em tarefa não trivial, nega permissão
- Com `trivialDirectAllowed=true`, tarefas triviais fast continuam diretas

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

- `src/index.ts` → hooks e comandos do plugin
- `src/router/config.ts` → load/validate/save de config
- `src/router/protocol.ts` → protocolo injetado no system
- `src/router/classifier.ts` → classificação de tarefas
- `src/router/caps.ts` → cap tracker + redundância
- `src/narration.ts` → detecção de narração
- `test/*.test.ts` → testes unitários

---

## Licença

Defina a licença do projeto em `package.json` conforme sua necessidade.
