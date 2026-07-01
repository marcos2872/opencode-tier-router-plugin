# opencode-tier-router-plugin

Plugin para OpenCode que combina orquestração Compose com memória persistente BM25 e roteamento por tier de custo.

## O que faz

- **Compose Agent** como orquestrador principal com 17 skills de workflow
- **Memory Tool** com busca BM25 via SQLite para conhecimento persistente
- **3 subagentes com modelos diferentes**: explore (leitura), general (implementação), general-heavy (análise)

## Instalação

### 1. Clonar e build

```bash
git clone <repo-url>
cd opencode-tier-router-plugin
npm install
npm run build
```

### 2. Configurar no projeto alvo

Crie `.opencode/opencode.json` na raiz do projeto:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["<caminho-absoluto>/opencode-tier-router-plugin/dist/index.js"]
}
```

Crie symlinks para agents, prompts e skills:

```bash
PLUGIN=<caminho-absoluto>/opencode-tier-router-plugin
PROJETO=/seu/projeto

# Agents
mkdir -p $PROJETO/.opencode/agents
for f in $PLUGIN/agents/*.md; do
  ln -sf "$f" "$PROJETO/.opencode/agents/$(basename $f)"
done

# Prompts
mkdir -p $PROJETO/.opencode/prompts
ln -sf $PLUGIN/prompts/* $PROJETO/.opencode/prompts/

# Skills
mkdir -p $PROJETO/.opencode/skills
for d in $PLUGIN/skills/compose/*/; do
  ln -sf "$d" "$PROJETO/.opencode/skills/$(basename $d)"
done
```

### 3. Configurar modelos

Crie `tiers.json` na raiz do projeto (ou `~/.config/opencode/tiers.json` para global):

```json
{
  "compose": { "model": "opencode/big-pickle" },
  "explore": { "model": "opencode/big-pickle" },
  "general-medium": { "model": "llama.cpp/Nex-N2-mini" },
  "general-heavy": { "model": "opencode/mimo-v2.5-free" }
}
```

### 4. Reiniciar o OpenCode

## Agentes

| Agente | Papel | Modelo |
|--------|-------|--------|
| `compose` | Orquestrador — delega tudo via actor | compose.model |
| `explore` | Leitura rápida — grep, glob, read, git | explore.model |
| `general` | Implementação — fix, refactor, test, create | general-medium.model |
| `general-heavy` | Análise — review, architecture, design, debug | general-heavy.model |
| `checkpoint-writer` | Grava checkpoints de sessão (hidden) | — |
| `dream` | Consolida memória de longo prazo (hidden) | — |

## Roteamento

O compose escolhe o agent pelo nome. Cada agent tem seu modelo embutido:

| Tarefa | Agent |
|--------|-------|
| Ler arquivo, grep, git | explore |
| Fix bug, refactor, test | general |
| Code review, architecture, design | general-heavy |

## Skills

17 skills de compose: ask, brainstorm, code-conventions, debug, execute, feedback, merge, new-skill, parallel, plan, report, review, route, subagent, tdd, verify, worktree.

## Licença

MIT
