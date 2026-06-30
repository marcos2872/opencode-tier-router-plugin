# opencode-compose-plugin — Documentação do Projeto

## Visão Geral

Plugin para OpenCode que combina orquestração Compose, memória persistente BM25 e roteamento por tier de custo.

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Bun (OpenCode) |
| Linguagem | TypeScript 5.7+ |
| Build | tsc |
| SQLite | bun:sqlite (nativo) |
| Busca | FTS5 (BM25) |
| API | `@opencode-ai/plugin` |

## Estrutura

```
opencode-compose-plugin/
├── src/
│   ├── index.ts          # Plugin entry: config + tool hooks
│   ├── config.ts         # Cria agentes compose/explore/general
│   └── memory/
│       ├── store.ts      # SQLite FTS5 (bun:sqlite)
│       ├── tool.ts       # Ferramenta memory (search/write)
│       └── reconcile.ts  # Indexa .md no SQLite
├── agents/               # Definições dos agentes (.md)
├── skills/compose/       # 16 skills de orquestração
├── prompts/              # System prompts
├── tiers.json            # Config de modelos
└── package.json
```

## Agentes

| Agente | Modo | Modelo default | Papel |
|--------|------|----------------|-------|
| `compose` | primary | opencode/big-pickle | Orquestrador com 16 skills |
| `explore` | subagent | opencode/big-pickle | Leitura rápida |
| `general-medium` | subagent | llama.cpp/Nex-N2-mini | Implementação |
| `general-heavy` | subagent | llama.cpp/Nex-N2-mini | Arquitetura |
| `checkpoint-writer` | hidden | — | Grava checkpoints |
| `dream` | hidden | — | Consolida memória |

## Memória

### Estrutura global

```
~/.config/opencode/memory/
├── global/
│   └── MEMORY.md                    ← dream cria
├── projects/
│   └── <project-id>/
│       ├── memory.db                ← SQLite FTS5
│       └── sessions/
│           └── <session-id>/
│               ├── checkpoint.md    ← checkpoint-writer cria
│               └── tasks/
│                   └── T1/
│                       └── progress.md
```

### Fluxo

1. **Agentes** (checkpoint-writer, dream) criam `.md` files
2. **Memory tool** escreve no SQLite
3. **Reconcile** lê `.md` e indexa no SQLite na inicialização

### Uso

```
memory({ operation: "search", query: "auth" })
memory({ operation: "write", scope: "compose", path: "decisao.md", content: "..." })
```

## Skills

16 skills de compose: route, brainstorm, plan, tdd, debug, verify, review, execute, subagent, report, merge, parallel, worktree, feedback, ask, new-skill.

## Configuração

### tiers.json

```json
{
  "explore": { "model": "opencode/big-pickle" },
  "general-medium": { "model": "llama.cpp/Nex-N2-mini" },
  "general-heavy": { "model": "llama.cpp/Nex-N2-mini" }
}
```

### opencode.json

```json
{
  "agent": {
    "compose": { "mode": "primary" },
    "explore": { "mode": "subagent", "model": "opencode/big-pickle" },
    "general-medium": { "mode": "subagent", "model": "llama.cpp/Nex-N2-mini" },
    "general-heavy": { "mode": "subagent", "model": "llama.cpp/Nex-N2-mini" }
  }
}
```

## Licença

MIT
