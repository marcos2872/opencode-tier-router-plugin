# opencode-tier-router — Documentação do Projeto

## Visão Geral

O **opencode-tier-router** é um plugin para OpenCode que implementa **roteamento inteligente de tarefas** para diferentes tiers de modelos de linguagem (`@fast`, `@medium`, `@heavy`) com o objetivo de **reduzir custos operacionais mantendo a qualidade das respostas**.

O plugin classifica automaticamente o tipo de tarefa solicitada pelo usuário e direciona para o modelo mais adequado e econômico, sem necessidade de infraestrutura externa (proxies, agentes dedicados ou routers separados).

## Objetivo

- **Reduzir custo**: até 83% de redução em cenários reais (referência: paper Agent-as-a-Router)
- **Manter qualidade**: tarefas simples usam modelos rápidos/baratos; tarefas complexas usam modelos poderosos
- **Zero fricção**: integração nativa via plugin OpenCode, sem infraestrutura adicional
- **Transparência**: protocolo de delegação visível no system prompt (~210 tokens)

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
│   ├── STATE.md               # Decisões ativas (AD-001 a AD-005)
│   └── features/              # Features planejadas/implementadas
├── dist/                      # Saída do build (dist/index.js)
├── docs/                      # Documentação técnica
│   ├── projeto.md             # Este arquivo
│   └── arquitetura.md         # Decisões e componentes arquiteturais
├── src/
│   ├── index.ts               # Entry point: hooks e comandos do plugin
│   ├── narration.ts           # Detecção de narração vs. trabalho real
│   └── router/                # Módulos core do roteamento
│       ├── caps.ts            # Rastreamento de caps e detecção de redundância
│       ├── classifier.ts      # Classificação de tarefas por keywords
│       ├── config.ts          # Load/validate/save de tiers.json
│       ├── protocol.ts        # Construção do protocolo de delegação (~210 tokens)
│       └── selector.ts        # Seleção de tier (keyword ou LLM) com fallback
├── test/                      # Testes unitários (*.test.ts)
├── tiers.json                 # Configuração principal (tiers, modos, enforcement)
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
     - Bloqueia execução direta de tools em tarefas não-triviais
     - Força delegação via `Task()` para o tier correto
   - Se `enforcement.mode = "advisory"`:
     - Apenas orienta, não bloqueia

5. **Monitoramento** (hooks `tool.execute.before/after`):
   - Rastreia caps de leitura e detecta redundância
   - Injeta banners `[cap:N/MAX]`, `[⚠ CAP WARNING]`, `[⚠ CAP REACHED]`

6. **Comandos disponíveis**:
   - `/tiers` — exibe configuração ativa
   - `/budget` — lista modos ou troca modo
   - `/router on|off` — liga/desliga o plugin

## Configuração (`tiers.json`)

O arquivo `tiers.json` controla todo o comportamento do plugin. Resolução em camadas:

1. `./tiers.json` (projeto local) — **prioridade máxima**
2. `~/.config/opencode/tiers.json` (global)
3. Defaults internos do plugin (FALLBACK_CONFIG em src/index.ts)

### Exemplo mínimo

```json
{
  "mode": "normal",
  "tiers": {
    "fast": { "model": "github-copilot/claude-haiku-4.5", "costRatio": 1, "cap": 8 },
    "medium": { "model": "github-copilot/gpt-5.3-codex", "costRatio": 5, "cap": 12 },
    "heavy": { "model": "github-copilot/claude-sonnet-4.5", "costRatio": 20, "cap": 20 }
  },
  "modes": {
    "normal": { "defaultTier": "medium" }
  },
  "taskPatterns": {
    "fast": ["find", "search", "read", "buscar"],
    "medium": ["implement", "refactor", "fix", "criar"],
    "heavy": ["design", "architecture", "debug", "analisar"]
  },
  "enforcement": {
    "mode": "hard-block",
    "trivialDirectAllowed": true
  },
  "routing": {
    "strategy": "keyword",
    "selectorModel": "github-copilot/claude-haiku-4.5",
    "selectorTimeoutMs": 1200,
    "selectorMaxTokens": 16
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

| Agente | Tier |
|--------|------|
| `explore` | `@fast` |
| `build` | `@medium` |
| `general` | `@heavy` |
| `plan` | `@heavy` |

Ver src/index.ts:13-18.

## Exemplos de Uso

### Tarefa fast (busca simples)

```
busque autenticação no projeto
```

→ Classificado como `@fast` (keyword: "busque")  
→ Roteado para modelo rápido/barato (ex: claude-haiku-4.5)

### Tarefa medium (implementação)

```
refatore a função de login para usar async/await
```

→ Classificado como `@medium` (keyword: "refatore")  
→ Roteado para modelo intermediário (ex: gpt-5.3-codex)

### Tarefa heavy (arquitetura/debug)

```
analyze code quality and propose architecture changes
```

→ Classificado como `@heavy` (keyword: "analyze", "architecture")  
→ Roteado para modelo poderoso (ex: claude-sonnet-4.5)

## Troubleshooting

| Problema | Causa Provável | Solução |
|----------|----------------|---------|
| `Model not found` | ID de modelo inválido para o provider | Verificar com `/models` e ajustar `tiers.json` |
| Não está delegando | Keywords não cobrem o prompt real | Ajustar `taskPatterns` ou usar `enforcement.mode="hard-block"` |
| Delega mas mantém modelo errado | Tier configurado incorretamente | Verificar `/tiers` e ajustar `tiers.<tier>.model` |
| Aviso de `tiers.json` ausente | Arquivo não existe no projeto nem no global | Criar `tiers.json` no projeto ou em `~/.config/opencode/` |

## Links Relacionados

- [Arquitetura](./arquitetura.md) — decisões arquiteturais e componentes internos
- [AGENTS.md](../AGENTS.md) — workflow de desenvolvimento TLC
- [STATE.md](../.specs/STATE.md) — decisões ativas (AD-001 a AD-005)
- [README.md](../README.md) — overview rápido e instalação

## Licença

Defina a licença no `package.json` conforme a política do projeto.
