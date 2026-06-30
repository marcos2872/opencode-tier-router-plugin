# Router Agent Design

## 1. Nova arquitetura

Diagrama textual:

```text
User
  │
  ▼
Plugin (OpenCode)
  │
  └── hook config(input)
        │
        ├── load/validate tiers.json
        │
        ├── create Router agent
        │     name: agentName || "router"
        │     model: agentModel || "opencode/big-pickle"
        │     systemPrompt: routerPrompt || DEFAULT_ROUTER_PROMPT
        │     permissions: { task: allow, skill: allow, demais ferramentas nativas de execução: deny }
        │
        └── create subagents
              @fast  -> permissions: allow, mode: subagent, systemPrompt próprio
              @medium -> permissions: allow, mode: subagent, systemPrompt próprio
              @heavy  -> permissions: allow, mode: subagent, systemPrompt próprio

Router agent
  │
  ├── não executa read/grep/bash/edit/write/etc.
  ├── lê o system prompt configurado em tiers.json
  └── decide para qual tier delegar
        │
        ▼
task("@fast") / task("@medium") / task("@heavy")
        │
        ▼
Subagent executam tarefa com suas ferramentas permitidas
```

Comportamento esperado:

- O plugin não intercepta `chat.message`, `permission.ask`, `tool.execute.before`, `event` ou hooks de prompt.
- O Router não responde diretamente com ferramentas nativas de execução; ele deve chamar `task()` para delegar.
- O Router pode usar `skill` quando necessário, mas deve bloquear ferramentas nativas de execução como `read`, `grep`, `bash`, `edit` e `write`.
- Usuário pode trocar para Build/Plan ou outro agente sem interferência do plugin.
- A política de bloqueio fica no agente Router, não no fluxo de sessão.

## 2. Estrutura de arquivos resultado

```text
src/
├── index.ts          # Só registra hook config + inicialização
└── config.ts         # load/validate tiers.json + cria Router + subagents
```

Removidos ou drasticamente simplificados:

```text
src/plugin-orchestrator.ts  # removido
src/prompts.ts              # removido
src/narration.ts            # removido
src/router/                 # removido
│ ├── selector.ts
│ ├── classifier.ts
│ ├── protocol.ts
│ ├── enforcement-validator.ts
│ └── caps.ts
src/utils/logger.ts          # removido
src/utils/safe-json.ts       # removido
```

## 3. Novo `tiers.json`

```json
{
  "mode": "balanced",
  "agentName": "router",
  "agentModel": "opencode/big-pickle",
  "routerPrompt": "Você é o Router, um agente orquestrador.\n\n## Tiers disponíveis\n@fast: ...\n@medium: ...\n@heavy: ...\n\n## Regras de delegação\nSempre delegue para @fast, @medium ou @heavy. Não execute diretamente.",
  "tiers": {
    "fast": {
      "model": "opencode/big-pickle",
      "systemPrompt": "Custom prompt para @fast...",
      "costRatio": 1,
      "cap": 8,
      "thresholds": { "min": 0, "max": 2000 }
    },
    "medium": {
      "model": "opencode/big-pickle",
      "systemPrompt": "Custom prompt para @medium...",
      "costRatio": 5,
      "cap": 4,
      "thresholds": { "min": 2001, "max": 10000 }
    },
    "heavy": {
      "model": "opencode/big-pickle",
      "systemPrompt": "Custom prompt para @heavy...",
      "costRatio": 20,
      "cap": 2,
      "thresholds": { "min": 10001, "max": 999999 }
    }
  },
  "modes": {
    "balanced": { "defaultTier": "medium" },
    "budget": { "defaultTier": "fast" },
    "quality": { "defaultTier": "medium" },
    "deep": { "defaultTier": "heavy" }
  }
}
```

Campos mínimos:

- `mode`: string obrigatória.
- `tiers`: objeto obrigatório.
- `modes`: objeto obrigatório.
- `agentName`: string opcional, default `router`.
- `agentModel`: string opcional, default `opencode/big-pickle`.
- `routerPrompt`: string opcional, prompt do Router.
- `fast.systemPrompt`, `medium.systemPrompt` e `heavy.systemPrompt`: strings opcionais para customizar o `systemPrompt` dos subagentes.
- `taskPatterns`: opcional e ignorado.

## 4. Criação dos subagentes

O plugin cria @fast, @medium e @heavy no hook `config` como agentes `mode: subagent`, com ferramentas permitidas e `systemPrompt` próprio. O `systemPrompt` vem primeiro da config (`cfg.tiers.<tier>.systemPrompt`) e, se ausente, do prompt padrão embutido no plugin.

```typescript
input.agent.fast = {
  model: cfg.tiers.fast.model,
  mode: 'subagent',
  systemPrompt: cfg.tiers.fast.systemPrompt ?? 
    `Você é @fast — agente de consulta rápida e leve.
Regras:
- Seja direto e conciso, sem análise profunda
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Se a tarefa exigir análise complexa ou debug, avise que talvez precise do @medium ou @heavy`,
  permission: { read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow', list: 'allow', bash: 'allow', webfetch: 'allow', websearch: 'allow', todowrite: 'allow', question: 'allow', skill: 'allow' },
  description: 'Tier router @fast subagent — consultas rápidas e busca',
};

input.agent.medium = {
  model: cfg.tiers.medium.model,
  mode: 'subagent',
  systemPrompt: cfg.tiers.medium.systemPrompt ??
    `Você é @medium — agente de implementação e refatoração.
Regras:
- Implemente, refatore, corrija e edite conforme solicitado
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Prefira soluções simples e diretas; para mudanças arquiteturais profundas, avise que @heavy pode ser mais adequado`,
  permission: { ... allow ... },
  description: 'Tier router @medium subagent — implementação e refatoração',
};

input.agent.heavy = {
  model: cfg.tiers.heavy.model,
  mode: 'subagent',
  systemPrompt: cfg.tiers.heavy.systemPrompt ??
    `Você é @heavy — agente de análise profunda e arquitetura.
Regras:
- Analise, projete, debuge e otimize com profundidade
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Considere trade-offs, impacto no sistema todo, e documente decisões`,
  permission: { ... allow ... },
  description: 'Tier router @heavy subagent — arquitetura, debug e design',
};
```

## 5. Formato do prompt do Router ao delegar

Ao chamar `task()`, o Router deve formatar o prompt do subagente assim:

```text
[INSTRUÇÃO DO USUÁRIO]: <texto original do usuário>

[CONTEXTO ADICIONAL]: <se o Router tiver informações relevantes>

[TIER]: @fast/@medium/@heavy
```

O Router **não** precisa repetir as regras do subagente no prompt da task, porque elas já estão no `systemPrompt` configurado na criação do subagente.

## 6. Hooks removidos

`experimental.chat.system.transform` é removido porque os `systemPrompt` dos subagentes já estão configurados diretamente na criação dos agentes. Não há mais dependência da ordem de execução entre `experimental.chat.system.transform` e `chat.message` para injetar diretrizes nos subagentes.

## 7. Prompt padrão do Router

Quando `routerPrompt` não é fornecido, usar:

```text
Você é o Router, um agente orquestrador do plugin opencode-tier-router-plugin.

## Seu papel

Você não executa ferramentas de leitura, escrita, terminal, busca ou edição. Sua função é analisar a solicitação do usuário e delegar a tarefa para o subagente mais adequado.

## Tiers disponíveis

@fast
- Modelo: opencode/big-pickle
- Capacidade: tarefas rápidas, consultas, exploração de arquivos, respostas curtas e buscas.
- Use para: perguntas simples, localizar informações, ler contexto rápido e validar mudanças pequenas.

@medium
- Modelo: opencode/big-pickle
- Capacidade: implementação moderada, refatorações, testes, integração de mudanças e debug comum.
- Use para: tarefas que exigem raciocínio, edição de código, execução de testes ou múltiplas etapas.

@heavy
- Modelo: opencode/big-pickle
- Capacidade: tarefas complexas, arquitetura, planejamento profundo, debugging extenso e mudanças de alto risco.
- Use para: decisões arquiteturais, diagnósticos difíceis, migrações, refatorações grandes ou análise de impacto.

## Regras de delegação

1. Sempre delegue para @fast, @medium ou @heavy usando task().
2. Nunca responda diretamente com ferramentas nativas.
3. Se a tarefa for simples, rápida ou de consulta, use @fast.
4. Se a tarefa exigir implementação, teste, integração ou debug moderado, use @medium.
5. Se a tarefa exigir arquitetura, planejamento, análise profunda ou debugging extenso, use @heavy.
6. Se você tiver dúvida entre tiers, escolha o mais conservador e justifique a escolha no contexto da task.
7. Se a tarefa não exigir nenhuma alteração no projeto, ainda assim delegue para @fast ou @medium conforme o caso.
8. Nunca peça permissões desnecessárias; a execução deve ser feita pelo subagente escolhido.

## Exemplo

Usuário: "Explique como funciona este repositório."
Router: delegate to @fast.

Usuário: "Adicione uma feature..."
Router: delegate to @medium.

Usuário: "Refatore a arquitetura..."
Router: delegate to @heavy.
```

## 8. Validação do `tiers.json`

A validação deve garantir:

1. `tiers` existe e é objeto.
2. `modes` existe e é objeto.
3. `mode` ativo existe dentro de `modes`.
4. Cada `mode` possui `defaultTier` válido dentro de `tiers`.
5. `routerPrompt`, se presente, é string.
6. `agentName`, se presente, é string não vazia.
7. `agentModel`, se presente, é string não vazia.
8. `fast.systemPrompt`, `medium.systemPrompt` e `heavy.systemPrompt`, se presentes, são strings.
9. `taskPatterns`, se presente, é ignorado e não afeta o comportamento.
10. `enforcement` e `routing`, se presentes, são aceitos como propriedades não semânticas ou ignorados.

A validação deve falhar se `tiers` ou `modes` estiverem ausentes, incompletos ou contendo valores incompatíveis com a nova arquitetura.

## 9. Notas de segurança

- O Router deve ser configurado com permissões bloqueadas para ferramentas nativas de execução, mantendo `skill` como allow.
- Subagentes devem continuar com ferramentas permitidas.
- A configuração do plugin deve definir prompts em `systemPrompt` dos subagentes, não injetar prompts por hook.
- A decisão de delegado fica no Router; não há enforcement adicional no runtime.

## 10. Critérios de aceite principais

1. AC-001: dado `tiers.json` válido, plugin cria agente Router com `name = agentName`, `model = agentModel`, `permissions` com `task: allow`, `skill: allow` e demais ferramentas nativas de execução bloqueadas.
2. AC-002: dado `tiers.json` com `routerPrompt`, o system prompt do Router contém esse texto.
3. AC-003: dado `tiers.json` sem `routerPrompt`, um prompt padrão é usado.
4. AC-004: subagentes @fast/@medium/@heavy são criados com `permissions: allow`, `mode: subagent` e `systemPrompt` próprio.
5. AC-004a: subagentes @fast/@medium/@heavy são criados com `systemPrompt` próprio que define identidade do tier e regras fixas.
6. AC-004b: `fast.systemPrompt`, `medium.systemPrompt` e `heavy.systemPrompt` são lidos da config e usados com fallback para prompts padrão embutidos.
7. AC-005: nenhum hook além de `config` é registrado.
8. AC-005a: a task delegada inclui instrução + contexto sem repetir regras fixas do subagente.
9. AC-006: `tiers.json` sem `taskPatterns` é válido e o campo é opcional ignorado.
10. AC-007: um `tiers.json` inválido sem `tiers` ou sem `modes` retorna erro de validação.
11. AC-008: Router não tem acesso a `read`, `grep`, `bash`, `edit`, `write`.
12. AC-009: Router pode chamar `task()` para delegar a subagentes.
13. AC-010: usuário pode editar `routerPrompt` no `tiers.json` e reiniciar para aplicar.
14. AC-004c: usuário pode customizar os system prompts dos subagentes em `tiers.json`.
