# opencode-tier-router-plugin — Documentação do Projeto

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
opencode-tier-router-plugin/
├── src/
│   ├── index.ts          # Plugin entry: config + tool hooks
│   ├── config.ts         # Cria agentes compose/explore/general/general-heavy
│   └── memory/
│       ├── store.ts      # SQLite FTS5 (bun:sqlite)
│       ├── tool.ts       # Ferramenta memory (search/write)
│       └── reconcile.ts  # Indexa .md no SQLite
├── agents/               # Definições dos agentes (.md)
├── skills/compose/       # 17 skills de orquestração
├── prompts/              # System prompts
├── tiers.json            # Config de modelos
└── package.json
```

## Agentes

| Agente | Modo | Modelo default | Papel |
|--------|------|----------------|-------|
| `compose` | primary | configurable via tiers.json | Orquestrador com 17 skills |
| `explore` | subagent | configurable via tiers.json | Leitura rápida |
| `general` | subagent | configurable via tiers.json | Implementação |
| `general-heavy` | subagent | configurable via tiers.json | Análise e review |
| `checkpoint-writer` | hidden | — | Grava checkpoints |
| `dream` | hidden | — | Consolida memória |

## Roteamento por Agent

O compose escolhe o agent pelo nome. Cada agent tem seu modelo embutido via tiers.json.

| Tarefa | Agent |
|--------|-------|
| Ler arquivo, grep, git | explore |
| Fix bug, refactor, test | general |
| Code review, architecture, design | general-heavy |

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

17 skills de compose: ask, brainstorm, code-conventions, debug, execute, feedback, merge, new-skill, parallel, plan, report, review, route, subagent, tdd, verify, worktree.

## Configuração

### tiers.json

```json
{
  "compose": { "model": "opencode/big-pickle" },
  "explore": { "model": "opencode/big-pickle" },
  "general-medium": { "model": "llama.cpp/Nex-N2-mini" },
  "general-heavy": { "model": "opencode/mimo-v2.5-free" }
}
```

### opencode.json

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["<caminho-absoluto>/opencode-tier-router-plugin/dist/index.js"]
}
```

## Licença

MIT
