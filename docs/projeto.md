# opencode-tier-router — Documentação do Projeto

## Visão Geral

O **opencode-tier-router** é um plugin para OpenCode que implementa **roteamento inteligente de tarefas** para diferentes tiers de modelos de linguagem (`@fast`, `@medium`, `@heavy`) com o objetivo de **reduzir custos operacionais mantendo a qualidade das respostas**.

O plugin classifica automaticamente o tipo de tarefa solicitada pelo usuário e direciona para o modelo mais adequado e econômico, sem necessidade de infraestrutura externa (proxies, agentes dedicados ou routers separados).

## Objetivo

- **Reduzir custo**: até 83% de redução em cenários reais (referência: paper Agent-as-a-Router)
- **Manter qualidade**: tarefas simples usam modelos rápidos/baratos; tarefas complexas usam modelos poderosos
- **Zero fricção**: integração nativa via plugin OpenCode, sem infraestrutura adicional
- **Transparência**: protocolo de delegação visível no system prompt (~210 tokens)
- **Rastreamento real**: captura de tokens via `tool.execute.after`, não estimativas heurísticas

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 18+ |
| Linguagem | TypeScript 5.7+ |
| Build | tsc (TypeScript Compiler) |
| Testes | Vitest 3.0 |
| API | `@opencode-ai/plugin` (hooks do OpenCode) |
| Configuração | JSON (tiers.json) |

## Estrutura de Pastas

```
opencode-tier-router/
├── .agents/                   # Skills TLC (tlc-spec-driven)
├── .specs/                    # Especificações e decisões arquiteturais
│   ├── STATE.md               # Decisões ativas (AD-001 a AD-006)
│   └── features/              # Features planejadas/implementadas
├── dist/                      # Saída do build (dist/index.js)
├── docs/                      # Documentação técnica
│   ├── projeto.md             # Este arquivo
│   └── arquitetura.md         # Decisões e componentes arquiteturais
├── src/
│   ├── index.ts               # Entry point: hooks e comandos do plugin
│   ├── plugin-orchestrator.ts # Orquestração de hooks (SRP extraction)
│   ├── narration.ts           # Detecção de narração vs. trabalho real
│   ├── constants.ts           # Constantes nomeadas (FALLBACK_CONFIG, regex)
│   ├── router/
│   │   ├── caps.ts            # Rastreamento de caps e detecção de redundância
│   │   ├── classifier.ts      # Classificação de tarefas por keywords
│   │   ├── config.ts          # Load/validate/save de tiers.json
│   │   ├── cost-calculator.ts # Cálculo centralizado de custo de tokens
│   │   ├── enforcement-validator.ts # Validação e bloqueio de enforcement
│   │   ├── filesystem-storage.ts    # Persistência em disco (JSON + LRU + TTL)
│   │   ├── in-memory-storage.ts     # Cache em memória (100 LRU, 30min TTL)
│   │   ├── metrics-aggregator.ts    # Agregação de sessões e acurácia de tier
│   │   ├── metrics-formatter.ts     # Geração de relatórios Markdown
│   │   ├── metrics-storage.ts       # Interface de armazenamento (adapter)
│   │   ├── orphan-buffer.ts         # Correlação de eventos (5s retry, FIFO)
│   │   ├── protocol.ts        # Construção do protocolo de delegação (~210 tokens)
│   │   ├── selector.ts        # Seleção de tier (keyword ou LLM) com fallback
│   │   ├── token-commands.ts  # Execução de comandos /token-*
│   │   ├── token-event-parser.ts    # Extração e parsing de eventos de token
│   │   └── token-tracker.ts   # API pública de rastreamento de tokens
│   └── utils/
│       └── safe-json.ts       # Parsing JSON seguro com limite de tamanho
├── test/                      # Testes unitários (300+ testes)
├── tiers.json                 # Configuração principal (tiers, modos, enforcement, tokenTracking)
├── package.json               # Dependências e scripts
├── tsconfig.json              # Config TypeScript (src)
└── tsconfig.test.json         # Config TypeScript (test)
```

## Fluxo de Execução Principal

1. **Inicialização** (hook `config`):
   - Carrega `tiers.json` (projeto local → global → defaults internos)
   - Valida configuração e inicializa estado do plugin

2. **Mensagem do usuário** (hook `chat.message`):
   - Analisa o texto da mensagem
   - Classifica a tarefa usando `taskPatterns` (ou LLM selector se configurado)
   - Determina o tier adequado (`@fast`, `@medium`, `@heavy`)

3. **Transformação do system prompt** (hook `chat.system.transform`):
   - Injeta o protocolo de delegação (~210 tokens) no system prompt
   - Protocolo informa ao modelo orquestrador:
     - Tiers disponíveis e seus custos relativos
     - Regras de classificação (keywords por tier)
     - Modo ativo (normal/budget/quality/deep)
     - Enforcement (advisory ou hard-block)

4. **Controle de permissões** (hook `permission.ask`):
   - Se `enforcement.mode = "hard-block"`:
     - `enforcement-validator.ts` valida se execução é permitida
     - Bloqueia execução direta de tools em tarefas não-triviais
     - Força delegação via `Task()` para o tier correto
   - Se `enforcement.mode = "advisory"`:
     - Apenas orienta, não bloqueia

5. **Monitoramento** (hooks `tool.execute.before/after`):
   - Rastreia caps de leitura e detecta redundância
   - Injeta banners `[cap:N/MAX]`, `[⚠ CAP WARNING]`, `[⚠ CAP REACHED]`

6. **Token Tracking** (hook `tool.execute.after`):
   - `token-event-parser.ts` extrai tokens reais do output da ferramenta
   - `cost-calculator.ts` calcula custo com base no tier
   - `token-tracker.ts` registra via `recordStepFinish`
   - OrphanBuffer correlaciona eventos com decisões de roteamento

7. **Comandos disponíveis**:
   - `/tiers` — exibe configuração ativa
   - `/budget` — lista modos ou troca modo
   - `/router on|off` — liga/desliga o plugin
   - `/token-report <sessionId>` — métricas de uma sessão
   - `/token-history` — lista sessões persistidas
   - `/token-compare <sessionId> <tier>` — custo hipotético em outro tier

## Configuração (`tiers.json`)

O arquivo `tiers.json` controla todo o comportamento do plugin. Resolução em camadas:

1. `./tiers.json` (projeto local) — **prioridade máxima**
2. `~/.config/opencode/tiers.json` (global)
3. Defaults internos do plugin (FALLBACK_CONFIG em src/constants.ts)

### Exemplo mínimo

```json
{
  "mode": "normal",
  "tiers": {
    "fast": { "model": "opencode/big-pickle", "costRatio": 1, "cap": 8 },
    "medium": { "model": "llama.cpp/Nex-N2-mini", "costRatio": 5, "cap": 12 },
    "heavy": { "model": "llama.cpp/Nex-N2-mini", "costRatio": 20, "cap": 20 }
  },
  "modes": {
    "normal": { "description": "Balanced routing", "defaultTier": "medium" },
    "budget": { "description": "Cost-first", "defaultTier": "fast" },
    "quality": { "description": "Quality-first", "defaultTier": "medium" },
    "deep": { "description": "Depth-first", "defaultTier": "heavy" }
  },
  "taskPatterns": {
    "fast": ["find", "search", "read", "buscar", "procurar", "listar", "mostrar"],
    "medium": ["refactor", "implement", "fix", "criar", "corrigir", "editar", "validar"],
    "heavy": ["design", "architecture", "debug", "analisar", "revisar", "diagnosticar"]
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
    "maxHistoryDays": 30,
    "sessionTTLMinutes": 30,
    "maxSessionsMemory": 100
  }
}
```

Ver [arquitetura.md](./arquitetura.md#configuração-tiers.json) para detalhes sobre cada campo.

## Comandos Úteis

### Build

```bash
npm install          # Instala dependências
npm run build        # Compila src/ → dist/index.js
```

### Verificação de Qualidade

```bash
npm run typecheck    # Verifica tipos (src + test)
npm run test         # Roda testes unitários (vitest)
npm run lint         # ESLint — zero erros
npm run format       # Prettier — formata todo o código
```

### Gate Completo (CI-style)

```bash
npm run typecheck && npm run test
```

## Como Começar

### 1. Instalar dependências

```bash
cd /home/marcos/Projects/opencode-router-model
npm install
```

### 2. Fazer build

```bash
npm run build
```

### 3. Ativar no projeto OpenCode alvo

No `opencode.json` do projeto onde você quer usar o router:

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model"
  ]
}
```

ou

```json
{
  "plugins": [
    "/home/marcos/Projects/opencode-router-model/dist/index.js"
  ]
}
```

### 4. Reiniciar sessão OpenCode e testar

```
/tiers
```

Deve exibir a configuração ativa (modo, enforcement, tiers, mapeamento de agentes).

### 5. Ajustar configuração (opcional)

Crie ou edite `tiers.json` no diretório do projeto alvo para customizar:

- Modelos por tier
- Keywords de classificação
- Modo padrão (normal/budget/quality/deep)
- Enforcement (advisory/hard-block)

## Mapeamento de Agentes Nativos

O plugin mapeia automaticamente agentes nativos do OpenCode para tiers:

| Agente | Tier | Modelo |
|--------|------|--------|
| `explore` | `@fast` | `opencode/big-pickle` |
| `build` | `@medium` | `llama.cpp/Nex-N2-mini` |
| `general` | `@heavy` | `llama.cpp/Nex-N2-mini` |
| `plan` | `@heavy` | `llama.cpp/Nex-N2-mini` |

Ver src/index.ts.

## Token Tracking

O plugin captura uso real de tokens via hook `tool.execute.after`, não estimativas.

### Event Format

```typescript
interface TokenRecord {
  inputTokens: number
  outputTokens: number
  cacheTokens?: number
  reasoningTokens?: number
  tier?: string
  toolName?: string
  timestamp?: number
}
```

### API Pública

```typescript
recordStepFinish(sessionId: string, tokens: TokenRecord): Promise<void>
recordRoutingDecision(sessionId: string, tier: string): Promise<void>
getSummary(sessionId: string): Promise<SessionMetrics | null>
persistTokenMetrics(sessionId: string): Promise<boolean>
getHistory(): Promise<SessionMetrics[]>
getSessionReport(sessionId: string): Promise<string>
getComparison(sessionId: string): Promise<string>
```

### Persistência (v1.0)

```json
{
  "version": "1.0",
  "sessionId": "abc123-def456",
  "createdAt": "2026-06-27T10:00:00Z",
  "records": [...],
  "routingDecisions": [...],
  "tierAccuracy": 0.85
}
```

### Comandos

| Comando | Descrição |
|---------|-----------|
| `/token-report <sessionId>` | Exibe métricas detalhadas da sessão |
| `/token-history` | Lista todas as sessões persistidas |
| `/token-compare <sessionId> <tier>` | Compara custo real vs. hipotético em outro tier |

## Exemplos de Uso

### Tarefa fast (busca simples)

```
busque autenticação no projeto
```

→ Classificado como `@fast` (keyword: "busque")
→ Roteado para `opencode/big-pickle`

### Tarefa medium (implementação)

```
refatore a função de login para usar async/await
```

→ Classificado como `@medium` (keyword: "refatore")
→ Roteado para `llama.cpp/Nex-N2-mini`

### Tarefa heavy (arquitetura/debug)

```
analyze code quality and propose architecture changes
```

→ Classificado como `@heavy` (keyword: "analyze", "architecture")
→ Roteado para `llama.cpp/Nex-N2-mini` (tier heavy)

## Troubleshooting

| Problema | Causa Provável | Solução |
|----------|----------------|---------|
| `Model not found` | ID de modelo inválido para o provider | Verificar com `/models` e ajustar `tiers.json` |
| Não está delegando | Keywords não cobrem o prompt real | Ajustar `taskPatterns` ou usar `enforcement.mode="hard-block"` |
| Delega mas mantém modelo errado | Tier configurado incorretamente | Verificar `/tiers` e ajustar `tiers.<tier>.model` |
| Aviso de `tiers.json` ausente | Arquivo não existe no projeto nem no global | Criar `tiers.json` no projeto ou em `~/.config/opencode/` |
| Hard-block bloqueia tudo | `trivialDirectAllowed=false` impede execução direta | Configurar `trivialDirectAllowed: true` se desejar |
| Eventos órfãos no token tracking | Race condition entre hooks | OrphanBuffer lida automaticamente com 5s de retry |
| Relatório de sessão vazio | Sessão não encontrada ou expirou | Verificar com `/token-history` o sessionId correto |

## Links Relacionados

- [Arquitetura](./arquitetura.md) — decisões arquiteturais e componentes internos
- [AGENTS.md](../AGENTS.md) — workflow de desenvolvimento TLC
- [STATE.md](../.specs/STATE.md) — decisões ativas (AD-001 a AD-006)
- [README.md](../README.md) — overview rápido e instalação

## Licença

Defina a licença no `package.json` conforme a política do projeto.
