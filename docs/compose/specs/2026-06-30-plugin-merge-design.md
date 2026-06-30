# Plugin Unificado: Compose + Router + Memory

## [S1] Problema

Dois plugins OpenCode complementares existem separadamente:
- **opencode-router-model**: Roteamento por tier via agente Router que delega para @fast/@medium/@heavy
- **opencode-plugin-compose-memory**: Orquestração compose com 15 skills + memória persistente BM25

O usuário quer "o melhor dos dois mundos": orquestração compose com memória persistente E roteamento por tier de custo.

## [S2] Solução

Criar um plugin unificado onde:
1. O **Compose** é o orquestrador principal (substitui o Router)
2. **Explore** é o subagente de baixo custo (leitura/exploração)
3. **General** é o subagente de médio/alto custo (implementação/debug)
4. **Memory tool** fornece busca BM25 persistente
5. **15 compose skills** orquestram o workflow de desenvolvimento

O Router é removido. Os tiers @fast/@medium/@heavy são absorvidos por explore e general.

## [S3] Agentes

| Agente | Papel | Modo | Modelo default |
|--------|-------|------|----------------|
| `compose` | Orquestrador principal, usa 15 skills | primary | opencode/big-pickle |
| `explore` | Leitura rápida, grep, git, exploração | subagent | opencode/big-pickle |
| `general` | Implementação, refatoração, debug, testes | subagent | llama.cpp/Nex-N2-mini |
| `checkpoint-writer` | Grava checkpoints de sessão (oculto) | hidden | opencode/big-pickle |
| `dream` | Consolida memória (oculto) | hidden | opencode/big-pickle |

### Regras de delegação do Compose

- O compose delega para **explore** quando a tarefa é leitura/exploração
- O compose delega para **general** quando a tarefa é implementação/edição
- Explore e general NÃO disparam sub-sub-agentes
- O compose pode usar qualquer skill para orquestrar

## [S4] Memory Tool

- Ferramenta `memory` registrada no hook `tool`
- Busca BM25 via SQLite FTS5 (better-sqlite3)
- Layout: `.opencode/memory/{global,projects,sessions}/`
- Operações: `search` (busca ranqueada) e `write` (persiste conhecimento)
- Reconciliação automática entre diretório de arquivos e banco SQLite

## [S5] Skills

15 skills de compose em `skills/compose/`:

| Skill | Propósito |
|-------|-----------|
| ask | Perguntas ao usuário via question tool |
| brainstorm | Exploração de ideias antes de implementar |
| plan | Criação de plano de implementação |
| tdd | Test-driven development |
| debug | Diagnóstico de bugs |
| execute | Execução de planos com checkpoints |
| subagent | Delegação para subagentes |
| verify | Verificação antes de afirmar conclusão |
| review | Revisão de código |
| report | Relatório final de features |
| merge | Integração de mudanças |
| parallel | Execução paralela de tarefas |
| worktree | Isolamento de workspace |
| feedback | Processamento de code review |
| new-skill | Criação de novas skills |

## [S6] Config

### Defaults hardcoded no plugin

```typescript
const DEFAULT_AGENTS = {
  compose: { model: 'opencode/big-pickle', mode: 'primary' },
  explore: { model: 'opencode/big-pickle', mode: 'subagent' },
  general: { model: 'llama.cpp/Nex-N2-mini', mode: 'subagent' },
  'checkpoint-writer': { model: 'opencode/big-pickle', mode: 'hidden' },
  dream: { model: 'opencode/big-pickle', mode: 'hidden' },
}
```

### tiers.json (opcional)

Se presente, permite customizar apenas **modelos** dos subagentes (explore, general). System prompts são fixos no código do plugin. Se ausente, os defaults são usados.

### Estrutura do plugin

```
src/
├── index.ts          # Plugin entry: config + tool hooks
├── config.ts         # Carrega/valida tiers.json, cria agentes
├── memory/
│   ├── tool.ts       # Ferramenta memory (search/write)
│   ├── store.ts      # SQLite FTS5 store
│   └── reconcile.ts  # Sincroniza arquivos ↔ banco
agents/
├── compose.md
├── explore.md
├── general.md
├── checkpoint-writer.md
└── dream.md
skills/
└── compose/
    ├── ask/
    ├── brainstorm/
    ├── ... (15 skills)
    └── worktree/
```

## [S7] Fora do escopo

| Feature | Motivo |
|---------|--------|
| Router como agente separado | Compose assume papel de orquestrador |
| Modos budget/balanced/quality | Simplificado para explore (baixo) + general (médio/alto) |
| taskPatterns/classifier | Decisão de tier é dinâmica via compose |
| Logs de routing | Sem hooks de observação |

## [S8] Critérios de sucesso

- [ ] Plugin registra hooks `config` e `tool`
- [ ] Compose agent é criado como primary com 15 skills
- [ ] Explore e general são criados como subagentes com modelos corretos
- [ ] Memory tool funciona com busca BM25
- [ ] Skills estão acessíveis via nomes compose:*
- [ ] tiers.json opcional permite customização de modelos
- [ ] Todos os testes existentes continuam passando
- [ ] Novos testes cobrem memory tool e agentes do compose
