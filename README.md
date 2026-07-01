# opencode-compose-plugin

Plugin para OpenCode que combina orquestração Compose com memória persistente BM25 e roteamento por tier de custo.

## O que faz

- **Compose Agent** como orquestrador principal com 16 skills de workflow
- **Memory Tool** com busca BM25 via SQLite para conhecimento persistente
- **Subagentes por tier**: explore (baixo custo), general-medium, general-heavy

## Instalação

### 1. Clonar e build

```bash
git clone <repo-url> /home/marcos/Projects/opencode-router-model
cd /home/marcos/Projects/opencode-router-model
npm install
npm run build
```

### 2. Configurar no projeto alvo

Crie `opencode.json` na raiz do projeto:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/home/marcos/Projects/opencode-router-model/dist/index.js"],
  "skills": {
    "paths": ["/home/marcos/Projects/opencode-router-model/skills"]
  }
}
```

Crie symlinks para agents e prompts:

```bash
PLUGIN=/home/marcos/Projects/opencode-router-model
PROJETO=/seu/projeto

# Agents
mkdir -p $PROJETO/.opencode/agents
for f in $PLUGIN/agents/*.md; do
  ln -sf "$f" "$PROJETO/.opencode/agents/$(basename $f)"
done

# Prompts
mkdir -p $PROJETO/.opencode/prompts
ln -sf $PLUGIN/prompts/* $PROJETO/.opencode/prompts/
```

### 3. Configurar modelos

Crie `tiers.json` na raiz do projeto:

```json
{
  "explore": { "model": "opencode/big-pickle" },
  "general-medium": { "model": "llama.cpp/Nex-N2-mini" },
  "general-heavy": { "model": "llama.cpp/Nex-N2-mini" }
}
```

### 4. Reiniciar o OpenCode

## Agentes

Definidos em `.opencode/agents/*.md` (symlinks):

| Agente | Papel | Modelo (tiers.json) |
|--------|-------|---------------------|
| `compose` | Orquestrador com skills | opencode/big-pickle |
| `explore` | Leitura rápida | opencode/big-pickle |
| `general` | Implementação/debug/arquitetura | llama.cpp/Nex-N2-mini |

## Skills

16 skills via `skills.paths` no opencode.json: route, brainstorm, plan, tdd, debug, verify, review, execute, subagent, report, merge, parallel, worktree, feedback, ask, new-skill.

## Uso

- Leitura → `explore`
- Código → `general-medium`
- Arquitetura → `general-heavy`

Skills via `/skill-name`: `/brainstorm`, `/plan`, `/tdd`, `/verify`

## Licença

MIT
