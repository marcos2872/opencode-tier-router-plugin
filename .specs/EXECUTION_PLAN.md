# 📋 Plano de Execução: Código de Qualidade & Documentação

**Status**: ✅ Planejamento Completo  
**Total Esforço**: 25.25 horas  
**Total Tarefas**: 17  
**Data**: 27 de junho de 2026

---

## 📊 Resumo das Fases

```
┌─────────────────────────────────────────────────────────────┐
│ FASE 1: CRÍTICO (5h) — 4 tarefas                           │
├─────────────────────────────────────────────────────────────┤
│ ✓ 1.1 Remove 'as any' em token hook (1h)                  │
│ ✓ 1.2 Tipar 'tokens: any' parameter (0.5h)                │
│ ✓ 1.3 Corrigir race condition em LRU (2h)                 │
│ ✓ 1.4 Cleanup periódico em OrphanBuffer (1.5h)            │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ FASE 2: ARQUITETURA (8h) — 4 tarefas                       │
├─────────────────────────────────────────────────────────────┤
│ ✓ 2.1 Extrair CostCalculator (2h)                          │
│ ✓ 2.2 JSDoc completo em funções públicas (4h)              │
│ ✓ 2.3 Melhorar error handling (1h)                         │
│ ✓ 2.4 Type guards para OpenCodeClient (1h)                │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ FASE 3: REFATORAÇÃO (8h) — 4 tarefas                       │
├─────────────────────────────────────────────────────────────┤
│ ✓ 3.1 Extrair PluginOrchestrator (3h)                      │
│ ✓ 3.2 Otimizar touchLRU para O(1) (2h)                    │
│ ✓ 3.3 Cache regex patterns (1h)                           │
│ ✓ 3.4 Testes de race condition (2h)                       │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ FASE 4: POLISH (4.25h) — 5 tarefas                         │
├─────────────────────────────────────────────────────────────┤
│ ✓ 4.1 Magic numbers → constantes (1h)                      │
│ ✓ 4.2 Remover variáveis não usadas (0.25h)                │
│ ✓ 4.3 Criar CONTRIBUTING.md (2h)                          │
│ ✓ 4.4 Lint rule para TODOs (0.5h)                         │
│ ✓ 4.5 Size limit em JSON.parse (0.5h)                     │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ VERIFICAÇÃO: Verifier independente (2-3h)                  │
├─────────────────────────────────────────────────────────────┤
│ ✓ Validação de cada AC da spec                             │
│ ✓ Discrimination sensor (injetar faults)                    │
│ ✓ Geração de validation.md                                 │
│ ✓ Distilação de lessons                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Opciones de Execução

### **Opção A: Sequencial (Mais Simples, Familiar)**

**Timeline**: ~3-4 dias  
**Recurso**: 1 desenvolvedor  
**Risco**: Baixo

```
Dia 1 (Wed):  Fase 1 (5h)   → PR para review
Dia 2 (Thu):  Fase 2 (8h)   → Review + Merge
Dia 3 (Fri):  Fase 3 (8h)   → Review + Merge
Dia 4 (Mon):  Fase 4 (4.25h) → Final review
Dia 5 (Tue):  Verificação (2-3h) → Release
```

**Como começar**:
```bash
# 1. Crie feature branch
git checkout -b feat/code-quality-refactor

# 2. Inicie com Fase 1
# (Eu vou criar um task runner para isso)

# 3. Execute task por task
npm run typecheck && npx vitest run
git add -A && git commit -m "feat(token-tracker): ..."
```

---

### **Opção B: Paralelo com Sub-Agentes (Mais Rápido, Automatizado)**

**Timeline**: ~1.5-2 dias  
**Recurso**: 4 sub-agentes (Phase1, Phase2, Phase3, Phase4)  
**Risco**: Médio (merge conflicts possível)

```
Lançamento simultâneo:
  - Agent-P1: Fase 1 (5h)
  - Agent-P2: Fase 2 (8h)
  - Agent-P3: Fase 3 (8h)  [depend de P1, P2]
  - Agent-P4: Fase 4 (4.25h)

Sincronização:
  - Merge P1 → main
  - Merge P2 → main
  - P3 aguarda P1+P2
  - Merge P3 → main
  - Merge P4 → main

Verificação final:
  - Verifier independente roda automaticamente
  - Relatório de validation.md
```

**Como começar**:
```bash
git checkout -b feat/code-quality-refactor

# Delegar para 4 agentes em paralelo (será ofertado)
# Cada agente executa seus tasks atomicamente
```

---

### **Opção C: Híbrida (Balanceada)**

**Timeline**: ~2 dias  
**Recurso**: 2 sub-agentes

```
Fase 1+2 (paralelo, 5h + 8h = ~7h wall clock):
  - Agent-P12: Fase 1 + Fase 2 (5h + 8h = 13h)

Fase 3+4 (sequencial, 8h + 4.25h = ~12h wall clock):
  - Agent-P34: Fase 3 + Fase 4 (8h + 4.25h = 12h)
  - Depende de P12 completo

Verificação: Auto-run após P34
```

---

## 📊 Impacto Esperado

| Métrica | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| **Code Quality Score** | 82/100 | 92+/100 | +12% ⬆️ |
| **Type Safety** | 85/100 | 95/100 | +11% ⬆️ |
| **Documentation** | 65/100 | 90/100 | +38% ⬆️ |
| **Code Duplication** | 3 places | 1 place | -67% ⬇️ |
| **Critical Bugs** | 2 | 0 | -100% ⬇️ |
| **Test Coverage** | 85% | 85%+ | = ➡️ |
| **Lines in index.ts** | 385 | 200 | -48% ⬇️ |

---

## 🚀 Como Começar Agora

### **1. Revisar Documentação**

```bash
# Relatório completo de qualidade
cat /tmp/opencode/quality-report.md

# Plano em CSV (importável em Jira/GitHub Projects)
cat /tmp/opencode/correction-plan.csv

# Guia de docstrings para aplicar
cat /tmp/opencode/docstring-guide.md

# Specification e tasks (neste repo)
cat .specs/features/code-quality-refactor/spec.md
cat .specs/features/code-quality-refactor/tasks.md
```

### **2. Decidir Estratégia de Execução**

Qual opção você prefere?

**A)** 🟦 **Sequencial** — Simples, 3-4 dias, 1 desenvolvedor  
**B)** 🟩 **Paralelo** — Rápido, 1.5-2 dias, 4 agentes  
**C)** 🟨 **Híbrida** — Balanceada, 2 dias, 2 agentes  

Responda: **A**, **B**, ou **C** (ou outra sugestão)

### **3. Iniciar Execução**

Após você decidir a estratégia, faço:

- ✅ Criar feature branch
- ✅ Lançar agentes (se Opção B/C)
- ✅ Monitorar progresso
- ✅ Coordenar merges
- ✅ Executar verificação final

---

## 📝 Arquivos de Referência

| Documento | Localização | Descrição |
|-----------|------------|-----------|
| **Spec** | `.specs/features/code-quality-refactor/spec.md` | Requirements + ACs |
| **Tasks** | `.specs/features/code-quality-refactor/tasks.md` | 17 tarefas detalhadas |
| **Quality Report** | `/tmp/opencode/quality-report.md` | Análise completa (44.9 KB) |
| **Correction Plan** | `/tmp/opencode/correction-plan.csv` | CSV importável |
| **Docstring Guide** | `/tmp/opencode/docstring-guide.md` | Padrão JSDoc |
| **STATE.md** | `.specs/STATE.md` | Decisões e handoff |

---

## ⚠️ Dependências Críticas

```
Fase 1:
  - Task 1.1 → independente
  - Task 1.2 → independente
  - Task 1.3 ← Depende de 1.2
  - Task 1.4 → independente

Fase 2:
  - Task 2.1 ← Depende de 1.2
  - Task 2.2 → independente
  - Task 2.3 → independente
  - Task 2.4 ← Depende de 1.2

Fase 3:
  - Task 3.1 ← Depende de 2.2, 2.4
  - Task 3.2 ← Depende de 1.3
  - Task 3.3 → independente
  - Task 3.4 ← Depende de 1.3, 1.4

Fase 4:
  - Todas → independentes
```

---

## 📞 Próximo Passo

**Qual opção você escolhe?**

```
A) Sequencial (simples, familiar)
B) Paralelo (rápido, 4 agentes)
C) Híbrida (balanceada, 2 agentes)
Ou: Outra abordagem que você prefira
```

Responda com a letra (A, B, C) ou deixe mais detalhes, e vou iniciar a execução! 🚀
