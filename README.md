# opencode-compose-plugin

Plugin para OpenCode que combina orquestração Compose com memória persistente BM25 e roteamento por tier de custo.

## O que faz

- **Compose Agent** como orquestrador principal com 16 skills de workflow
- **Memory Tool** com busca BM25 via SQLite para conhecimento persistente
- **Subagentes por tier**: explore (baixo custo), general-medium, general-heavy

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

Crie symlinks para agents e prompts:

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
```

### 3. Configurar modelos

Crie `tiers.json` na raiz do projeto (ou `~/.config/opencode/tiers.json` para global):

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
| `explore` | Leitura rápida | explore.model |
| `general` | Implementação/debug/arquitetura | general-medium.model |

## Skills

16 skills via compose: route, brainstorm, plan, tdd, debug, verify, review, execute, subagent, report, merge, parallel, worktree, feedback, ask, new-skill.

## Roteamento de Modelo

O plugin injeta automaticamente o modelo do `tiers.json` no frontmatter dos agents. O compose decide qual tier usar baseado na complexidade da tarefa:

- **Leitura** (explore): `explore.model`
- **Implementação simples** (1-2 arquivos): `general-medium.model`
- **Tarefa complexa** (multi-arquivo): `general-heavy.model`

## Licença

MIT
