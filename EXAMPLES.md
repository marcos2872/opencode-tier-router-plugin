# Plugin Examples — Tier Routing

Guia prático para usar o plugin por roteamento de tarefas entre tiers de modelo.

---

## 1. Tarefas que tendem a `@fast`

Use `@fast` para buscas simples, leitura exploratória e consultas diretas.

```
busque autenticação no projeto
```

→ Classificado como `@fast` (keyword: "busque")
→ Roteado para `opencode/big-pickle`

---

## 2. Tarefas que tendem a `@medium`

Use `@medium` para implementação, correções e mudanças de código.

```
refatore a função de login para usar async/await
```

→ Classificado como `@medium` (keyword: "refatore")
→ Roteado para `llama.cpp/Nex-N2-mini`

---

## 3. Tarefas que tendem a `@heavy`

Use `@heavy` para arquitetura, debug complexo, análise e revisão.

```
analyze code quality and propose architecture changes
```

→ Classificado como `@heavy` (keyword: "analyze", "architecture")
→ Roteado para `llama.cpp/Nex-N2-mini` no tier heavy

---

## Fluxo Recomendado

1. Escolha o modo em `tiers.json` (`normal`, `budget`, `quality` ou `deep`).
2. Ajuste `taskPatterns` para cobrir os verbos reais usados no projeto.
3. Mantenha `enforcement.mode = "hard-block"` para exigir delegação.
4. Use `trivialDirectAllowed = false` quando todas as tarefas precisarem passar pelo roteador.
5. Reabra a sessão OpenCode e confirme a configuração com `/tiers`.

---

## Ajuste de Classificação

Se uma tarefa cai no tier errado:

```json
{
  "taskPatterns": {
    "fast": ["find", "search", "read", "buscar", "procurar", "listar"],
    "medium": ["refactor", "implement", "fix", "criar", "corrigir", "validar"],
    "heavy": ["design", "architecture", "debug", "analyze", "revisar", "diagnosticar"]
  }
}
```

---

## Exemplos por Modo

### `budget`

Prioriza o tier mais barato que corresponda à intenção da tarefa.

```
budget
```

Use quando tarefas simples forem frequentes e a tolerância a retrabalho for baixa.

### `quality`

Prioriza qualidade e usa `@medium` como padrão quando não houver match claro.

```
quality
```

Use quando tarefas de revisão, análise ou arquitetura forem comuns.

### `deep`

Prioriza `@heavy` para fluxos que exigem análise prolongada.

```
deep
```

Use quando o projeto exigir decisões mais amplas ou mudanças estruturais.

---

## Checklist Rápido

- [ ] `tiers.json` existe no projeto ou em `~/.config/opencode/tiers.json`.
- [ ] Os três tiers têm modelos válidos.
- [ ] `taskPatterns` cobre os verbos reais dos usuários.
- [ ] `enforcement.mode` está como `hard-block`, se a delegação for obrigatória.
- [ ] `trivialDirectAllowed` reflete a política desejada para tarefas triviais.
- [ ] O plugin foi reiniciado após alterar a configuração.