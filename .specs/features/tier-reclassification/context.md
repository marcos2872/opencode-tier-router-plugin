# Tier Reclassification — Context

**Gathered:** 2026-06-29
**Spec:** `.specs/features/tier-reclassification/spec.md`
**Status:** Ready for implementation

---

## Feature Boundary

Atualizar os padrões de classificação em três lugares para alinhar com o fluxo
de trabalho do usuário: `tiers.json` (taskPatterns), `selector.ts` (stems),
`prompts.ts` (LLM selector prompt).

---

## Implementation Decisions

### Três lugares para modificar

| Local | Propósito | Mudança |
|-------|-----------|---------|
| `tiers.json` → `taskPatterns` | Classificação por keyword (classifyByPattern) | Adicionar git, perguntas, specs, tasks ao fast/heavy |
| `src/router/selector.ts` → `FAST_STEMS`/`MEDIUM_STEMS`/`HEAVY_STEMS` | Classificação por stem (classifyByLexicon) | Adicionar stems de git, spec, task, rule |
| `src/prompts.ts` → `buildSelectorPrompt` | Prompt do seletor LLM | Expandir descrições para incluir git, português, specs |

### Novos padrões para `taskPatterns` (tiers.json)

**fast** (adicionar):
```
git, branch, commit, log, diff, status, push, pull, merge, clone,
onde, oque, como, qual, que, oq,
pergunta, duvida, doubt,
arquivo, diretorio, pasta
```

**medium** (manter, possivelmente ajustar):
```
fix, build, compilar, compila, refactor, implement, add, write,
create, edit, update, change, rename, test,
corrigir, refatorar, implementar, adicionar, escrever,
criar, editar, atualizar, alterar, renomear, compilar, validar
```

**heavy** (adicionar):
```
spec, specs, task, tasks, tasks.md, rule, rules, regra, regras,
projeto, planejar, plan, architecture, arquitetura,
design, estrutura, structure, sistema, system,
especificacao, especificar
```

### Novos stems para `selector.ts`

**FAST_STEMS** (adicionar):
```
'git', 'branch', 'commit', 'log', 'diff', 'status',
'pergunt', 'duvid', 'doubt', 'ondef', 'oquef', 'qual',
'arquiv', 'diretor', 'past'
```

**HEAVY_STEMS** (adicionar):
```
'spec', 'task', 'rule', 'regr', 'projet', 'planej',
'estrutur', 'sistem'
```

### Novo `buildSelectorPrompt`

```ts
export function buildSelectorPrompt(text: string): string {
  return [
    'Classify the user request into one tier: fast, medium, or heavy.',
    'Return exactly one word: fast OR medium OR heavy.',
    'fast = search/read/list/explore/git/log/buscar/listar/mostrar/pergunta',
    'medium = implement/refactor/fix/build/update/create/edit/test',
    'heavy = architecture/design/specs/tasks/rules/debug/analyze/review/arquitetura/especificacao/regras',
    `request: ${text}`,
  ].join('\n');
}
```

### Locais exatos das mudanças

| Arquivo | Mudança |
|---------|---------|
| `tiers.json` | Adicionar padrões de git/perguntas ao fast; spec/task/rule ao heavy |
| `src/router/selector.ts` | Adicionar stems de git ao FAST_STEMS; spec/task ao HEAVY_STEMS |
| `src/prompts.ts` | Atualizar `buildSelectorPrompt` com novas descrições |

### Testes

- Adicionar testes para `classifyTask` com palavras novas (git, spec, task)
- Adicionar testes para `buildSelectorPrompt` verificar novo conteúdo
- Testar cenários de múltiplos tiers (ex: "buscar e refatorar")

---

## Agent's Discretion

- Palavras exatas para incluir em cada tier (podem ser expandidas)
- Se "pergunta"/"doubt"/"duvida" deve estar em fast ou ser tratado separadamente
- Ordem exata dos stems no array (sem impacto funcional)

---

## Specific References

- `tiers.json:50-114` — taskPatterns atuais
- `src/router/selector.ts:26-120` — Stems atuais (FAST_STEMS, MEDIUM_STEMS, HEAVY_STEMS)
- `src/prompts.ts:21-30` — buildSelectorPrompt atual
- `src/router/classifier.ts:20-35` — classifyTask com ordem heavy→medium→fast

---

## Deferred Ideas

- Classificação por contexto da conversa (não apenas última mensagem)
- Pesos diferentes para stems (atualmente contagem simples)
- Padrões regex mais complexos (ex: negação: "buscar" mas NÃO "refatorar")
