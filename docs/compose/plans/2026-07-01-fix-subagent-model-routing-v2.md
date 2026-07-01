# Fix Subagent Model Routing — versão 2

**Problema:** Instruções no skill não forçam comportamento. O compose continua spawnando subagents sem passar `model`, herdando o modelo pai.

**Solução:** Injetar o modelo do tiers.json no frontmatter dos markdowns dos agents no config time. Automático, sem depender de instruções.

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/config.ts` | Modificar — adicionar `injectModelIntoFrontmatter()` |
| `agents/explore.md` | Modificar — adicionar campo `model:` no frontmatter |
| `agents/general.md` | Modificar — adicionar campo `model:` no frontmatter |

## Tarefa 1: Adicionar injeção automática de modelo no frontmatter

Em `src/config.ts`, adicionar função que lê o markdown, injeta `model:` no frontmatter, e reescreve:

```typescript
function injectModelIntoFrontmatter(mdPath: string, model: string): void {
  if (!pathExists(mdPath)) return;
  const content = readFileSync(mdPath, "utf8");
  const updated = content.replace(
    /^(---\n[\s\S]*?\n---)/m,
    (frontmatter) => {
      if (frontmatter.includes("model:")) {
        return frontmatter.replace(/^model:.*$/m, `model: "${model}"`);
      }
      const lines = frontmatter.split("\n");
      const descIdx = lines.findIndex((l) => l.startsWith("description:"));
      lines.splice(descIdx >= 0 ? descIdx + 1 : 1, 0, `model: "${model}"`);
      return lines.join("\n");
    }
  );
  writeFileSync(mdPath, updated, "utf8");
}
```

Chamar em `createExploreAgent` e `createGeneralAgent` após definir o config.

## Tarefa 2: Adicionar `model:` placeholder nos markdowns

Adicionar `model: ""` no frontmatter de `agents/explore.md` e `agents/general.md` para a função de injeção ter onde escrever.

## Tarefa 3: Build e verificação

Rodar `npm run build` e verificar que os markdowns foram atualizados com o modelo correto.
