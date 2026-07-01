---
name: code-conventions
description: Diretrizes universais de qualidade de código — SOLID, Clean Code, DDD, TDD e Clean Architecture. Use quando precisar revisar design de código, estruturar responsabilidades, aplicar princípios de baixo acoplamento e alta coesão, ou orientar decisões arquiteturais em qualquer linguagem
---

# ROTEAMENTO OBRIGATÓRIO

**ANTES de qualquer coisa, leia a tabela abaixo e use o agent correto:**

| Tarefa | subagent_type | model |
|--------|---------------|-------|
| Ler arquivo, grep, git | explore | (nenhum) |
| Code review | general | general-heavy |
| Análise de arquitetura | general | general-heavy |
| Análise de design | general | general-heavy |
| Verificar qualidade | general | general-heavy |
| Fix bug | general | general-medium |
| Refatorar | general | general-medium |

**Exemplo de chamada correta para code review:**
```
actor({ operation: { action: "run", subagent_type: "general", model: "general-heavy", description: "Code review", prompt: "[TASK]: Review code quality\n[OUTPUT]: Issues with file:line." } })
```

**NÃO use explore para review/analysis. Explore é apenas para ler arquivos brutos.**

---

# Princípios de Qualidade de Código

Esta skill define os princípios fundamentais de qualidade de código que devem orientar
toda implementação, revisão e refatoração.

## Convicção central

> Código bom é código que dá para **alterar sem causar bugs** e que está **bem documentado** o suficiente para que qualquer pessoa entenda o *porquê* das decisões.

## SOLID

- **S** — Single Responsibility: cada módulo tem um único motivo para mudar
- **O** — Open/Closed: aberto para extensão, fechado para modificação
- **L** — Liskov Substitution: subtipos substituem tipos base sem quebrar corretude
- **I** — Interface Segregation: interfaces pequenas e coesas
- **D** — Dependency Inversion: dependa de abstrações, não de detalhes

## Clean Code

- Nomes significativos que revelam intenção
- Funções pequenas e focadas (uma coisa só)
- Sem side effects ocultos
- Comente o porquê, não o quê
- Trate erros explicitamente

## Clean Architecture

- Dependências apontam para dentro (núcleo não depende de framework)
- Separação: Domínio → Casos de uso → Adaptadores
- Testabilidade sem banco, rede ou framework

## Critérios de avaliação

| Nível | Significado |
|---|---|
| **ERRO** | Viola princípios com risco funcional |
| **AVISO** | Viola princípios sem risco imediato (dívida técnica) |
| **SUGESTÃO** | Poderia ser mais claro ou coeso |
