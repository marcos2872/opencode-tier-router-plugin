# opencode-tier-router-plugin

🚀 **Plugin para OpenCode** que faz **roteamento inteligente por tiers de modelo** (`@fast`, `@medium`, `@heavy`) com base no tipo de tarefa + **rastreamento real de uso de tokens**.

Objetivo: reduzir custo, manter qualidade e fornecer **visibilidade completa de gastos reais** — tudo sem infra extra (proxy/router externo).

## ✨ Principais Recursos

- 🎯 **Roteamento por tier**: Classifica automaticamente e delega para o modelo mais adequado
- 💰 **Real Token Cost Tracking**: Captura uso real de tokens (input, output, reasoning, cache)
- 📊 **Relatórios de custo**: `/token-report`, `/token-history`, `/token-compare`
- 🔒 **Hard-block enforcement**: Garante 100% delegação para tiers (sem execução direta)
- ⚡ **Caps & redundância**: Monitora uso de leitura e detecta trabalho redundante
- 🔄 **Persistência**: Salva sessões em disco com LRU cache (100 sessões, 30min TTL)

---

## Visão geral

O plugin:

1. Lê a configuração de `tiers.json`
2. Injeta um protocolo de delegação (~210 tokens) no system prompt
3. Classifica tarefas por palavras-chave (`taskPatterns`)
4. Direciona para tier adequado
5. Aplica controles de uso (caps e redundância) em subagentes
6. **[NOVO]** Captura eventos de `tool.execute.after` para rastrear tokens reais
7. **[NOVO]** Oferece comandos de análise de custo

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
  },
  "tokenTracking": {
    "enabled": true,
    "maxHistoryFiles": 50,
    "sessionTTLMinutes": 30,
    "maxSessionsMemory": 100
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
| `routing.strategy` | `keyword`, `llm` | Seleção de tier por keyword (padrão) ou por modelo rápido |
| `routing.selectorModel` | `provider/model` | Modelo usado para seleção quando `strategy=llm` |
| `routing.selectorTimeoutMs` | número > 0 | Timeout da seleção LLM |
| `routing.selectorMaxTokens` | número > 0 | Limite de tokens para resposta do selector |
| `tokenTracking.enabled` | `true`, `false` | Ativa/desativa rastreamento de tokens |
| `tokenTracking.maxHistoryFiles` | número > 0 | Máximo de arquivos de histórico no disco (FIFO cleanup) |
| `tokenTracking.maxHistoryDays` | número > 0 | Dias de retenção do histórico |
| `tokenTracking.sessionTTLMinutes` | número > 0 | Tempo de vida de sessões em cache (minutos) |
| `tokenTracking.maxSessionsMemory` | número > 0 | Máximo de sessões mantidas em memória (LRU eviction) |

---

## Comandos do plugin

### Roteamento & Configuração

| Comando | O que faz |
|---|---|
| `/tiers` | Mostra configuração ativa (modo, enforcement, tiers e mapeamento de agentes) |
| `/budget` | Lista modos disponíveis |
| `/budget <mode>` | Troca modo e persiste em `tiers.json` |
| `/router` | Mostra status do plugin (`on/off`) |
| `/router on` | Liga o roteador |
| `/router off` | Desliga o roteador |

### Token Tracking & Análise de Custo

| Comando | O que faz |
|---|---|
| `/token-report` | Mostra relatório de tokens e custo da sessão atual |
| `/token-history` | Lista todas as sessões com uso de tokens (memória + disco) |
| `/token-compare [sessão-id]` | Compara custo real vs. hipotético em outros tiers |

---

## 📊 Token Tracking & Cost Analysis

### Como funciona

1. **Captura de eventos**: O hook `tool.execute.after` captura o resultado de cada execução de tool
2. **Extração de tokens**: Detecta automaticamente formato JSON ou objeto direto com `{ inputTokens, outputTokens, cacheTokens, reasoningTokens }`
3. **Cálculo de custo**: Estima custo baseado em `costRatio` do tier
4. **Armazenamento**: Sessioniza em cache LRU (100 sessões, 30min TTL) + persiste em disco
5. **Análise**: Oferece relatórios, histórico e comparação de tiers

### Formato de evento capturado

A plugin espera eventos com a seguinte estrutura:

```json
{
  "inputTokens": 150,
  "outputTokens": 280,
  "cacheTokens": 0,
  "reasoningTokens": 50
}
```

Pode vir como:
- Propriedade `output.output` (JSON-encoded)
- Objeto direto no resultado
- Qualquer formato suportado — parser é tolerante

### Exemplo de sessão

```
Sessão: abc123-def456
├─ Step 1: search_files → input:100, output:50 → @fast (custo: $0.000225)
├─ Step 2: implement_fix → input:200, output:400 → @medium (custo: $0.00375)
├─ Step 3: review_code → input:150, output:300 → @heavy (custo: $0.009)
└─ Total: 750 tokens, $0.012225, accuracy: 85%
```

### Comandos em ação

#### `/token-report`
```
# Token Usage Report

Session: abc123-def456
├─ Total Input:  450 tokens
├─ Total Output: 750 tokens
├─ Total Cost:   $0.01223
└─ Tier Accuracy: 85% (87% @medium cost vs. actual)
```

#### `/token-history`
```
Recent Sessions:
1. abc123-def456  [30min ago] 1200 tokens  $0.01223  @medium
2. xyz789-abc000  [2h ago]    2340 tokens  $0.02891  @heavy
3. ...
```

#### `/token-compare [session-id]`
```
Hypothetical Cost Comparison for abc123-def456:

└─ Actual:   750 tokens @ @medium = $0.01223  ✓
└─ If @fast: 750 tokens @ @fast   = $0.00245  (↓80% cost, risk: accuracy)
└─ If @heavy: 750 tokens @ @heavy = $0.04500  (↑268% cost, risk: overkill)
```

---

## Advisory vs Hard-block

### `advisory`

- Injeta protocolo de delegação
- Não bloqueia execução direta
- Melhor para fluxo padrão

### `hard-block`

- Tenta forçar delegação para tier correto
- Se sessão principal tentar executar tools direto em tarefa não trivial, nega permissão
- Com `trivialDirectAllowed=false` (padrão), **toda** tarefa precisa delegar — mesmo tarefas triviais
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

- `src/index.ts` → hooks e comandos do plugin
- `src/plugin-orchestrator.ts` → orquestração de hooks (SRP extraction)
- `src/constants.ts` → constantes nomeadas (FALLBACK_CONFIG, regex)
- `src/narration.ts` → detecção de narração

### Roteamento & Delegação

- `src/router/config.ts` → load/validate/save de config
- `src/router/protocol.ts` → protocolo injetado no system (~210 tokens)
- `src/router/classifier.ts` → classificação de tarefas por keywords
- `src/router/selector.ts` → seletor de tier (keyword/LLM + fallback)
- `src/router/caps.ts` → cap tracker + redundância
- `src/router/cost-calculator.ts` → cálculo centralizado de custo
- `src/router/enforcement-validator.ts` → validação de enforcement

### Token Tracking & Análise

- `src/router/token-tracker.ts` → API pública (recordStepFinish, getSummary, persistTokenMetrics)
- `src/router/token-commands.ts` → execução de comandos (/token-report, /token-history, /token-compare)
- `src/router/token-event-parser.ts` → extração de eventos (TokenEventParser)
- `src/router/metrics-aggregator.ts` → agregação de métricas por sessão e tier
- `src/router/metrics-storage.ts` → interface de persistência (adapter pattern)
- `src/router/filesystem-storage.ts` → implementação em disco (JSON + LRU + TTL)
- `src/router/in-memory-storage.ts` → cache em memória
- `src/router/metrics-formatter.ts` → geração de relatórios (Markdown)
- `src/router/orphan-buffer.ts` → correlação de eventos órfãos (5s retry)
- `src/router/enforcement-validator.ts` → validação de enforcement no init

### Testes

- `test/phase0-modules.spec.ts` → 163 testes dos 5 módulos SRP + OrphanBuffer
- `test/enforcement-validator.spec.ts` → 37 testes de validação de enforcement
- `test/phase1-real-token-tracking.spec.ts` → 24 testes de captura de eventos
- `test/phase2-persistence.spec.ts` → 16 testes de persistência e carregamento
- `test/phase3-commands.spec.ts` → 25 testes de comandos (/token-report, etc)
- `test/phase4-e2e.spec.ts` → 20 testes de ciclo completo (sessão fim-a-fim)
- `test/phase5-plugin-integration.spec.ts` → 15 testes de integração plugin
- `ENFORCEMENT.md` → rules, architecture guarantees, security checklist

---

## Licença

MIT
