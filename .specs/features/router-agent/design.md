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
        │     permissions: { task: allow, demais: deny }
        │
        └── create subagents
              @fast  -> permissions: allow, mode: subagent
              @medium -> permissions: allow, mode: subagent
              @heavy  -> permissions: allow, mode: subagent

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
- O Router não responde diretamente com ferramentas nativas; ele deve chamar `task()` para delegar.
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

## 3. Formato do novo `tiers.json`

```json
{
  "mode": "balanced",
  "agentName": "router",
  "agentModel": "opencode/big-pickle",
  "tiers": {
    "fast": { "model": "opencode/big-pickle", "costRatio": 1, ... },
    "medium": { "model": "opencode/big-pickle", "costRatio": 5, ... },
    "heavy": { "model": "opencode/big-pickle", "costRatio": 20, ... }
  },
  "modes": {
    "balanced": { "defaultTier": "medium" },
    "budget": { "defaultTier": "fast" },
    "quality": { "defaultTier": "medium" },
    "deep": { "defaultTier": "heavy" }
  },
  "routerPrompt": "Você é o Router, um agente orquestrador.\n\n## Tiers disponíveis\n@fast: ...\n@medium: ...\n@heavy: ...\n\n## Regras de delegação\nSempre delegue para @fast, @medium ou @heavy. Não execute diretamente."
}
```

Campos mínimos:

- `mode`: string obrigatória.
- `tiers`: objeto obrigatório.
- `modes`: objeto obrigatório.
- `agentName`: string opcional, default `router`.
- `agentModel`: string opcional, default `opencode/big-pickle`.
- `routerPrompt`: string opcional, prompt do Router.
- `taskPatterns`: opcional e ignorado.

## 4. Prompt padrão do Router

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

## 5. Validação do `tiers.json`

A validação deve garantir:

1. `tiers` existe e é objeto.
2. `modes` existe e é objeto.
3. `mode` ativo existe dentro de `modes`.
4. Cada `mode` possui `defaultTier` válido dentro de `tiers`.
5. `routerPrompt`, se presente, é string.
6. `agentName`, se presente, é string não vazia.
7. `agentModel`, se presente, é string não vazia.
8. `taskPatterns`, se presente, é ignorado e não afeta o comportamento.
9. `enforcement` e `routing`, se presentes, são aceitos como propriedades não semânticas ou ignorados.

A validação deve falhar se `tiers` ou `modes` estiverem ausentes, incompletos ou contendo valores incompatíveis com a nova arquitetura.

## 6. Notas de segurança

- O Router deve ser configurado com permissões bloqueadas.
- Subagentes devem continuar com ferramentas permitidas.
- A configuração do plugin não deve injetar prompts em sessões de subagentes.
- A decisão de delegado fica no Router; não há enforcement adicional no runtime.

## 7. Critérios de aceite principais

1. AC-001: dado `tiers.json` válido, plugin cria agente Router com `name = agentName`, `model = agentModel`, `permissions` com `task: allow` e demais ferramentas bloqueadas.
2. AC-002: dado `tiers.json` com `routerPrompt`, o system prompt do Router contém esse texto.
3. AC-003: dado `tiers.json` sem `routerPrompt`, um prompt padrão é usado.
4. AC-004: subagentes @fast/@medium/@heavy são criados com `permissions: allow` e `mode: subagent`.
5. AC-005: nenhum hook além de `config` é registrado.
6. AC-006: `tiers.json` sem `taskPatterns` é válido e o campo é opcional ignorado.
7. AC-007: um `tiers.json` inválido sem `tiers` ou sem `modes` retorna erro de validação.
8. AC-008: Router não tem acesso a `read`, `grep`, `bash`, `edit`, `write`.
9. AC-009: Router pode chamar `task()` para delegar a subagentes.
10. AC-010: usuário pode editar `routerPrompt` no `tiers.json` e reiniciar para aplicar.
