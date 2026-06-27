# 🎯 Token Tracking Commands — Usage Examples

Guia prático dos 3 comandos de análise de custo do plugin.

---

## 1️⃣ `/token-report <sessionId>` — Análise Detalhada

Mostra métricas completas de uma sessão: tokens reais, custo, acurácia de tier.

### Sintaxe
```
/token-report <sessionId>
```

### Exemplo
```
/token-report sess-abc123-def456
```

### Saída Esperada
```
## Real Token Cost Report
**Session:** `sess-abc123-def456`
**Requests:** 3
**Duration:** 50s

### Usage Summary
Total tokens: 1630
  - Input: 500
  - Output: 980
  - Reasoning: 150
  - Cache read: 5
Total real cost: $0.015000
Average cost ratio: 2.4x

### Tier Accuracy
✅ Right: 35.0%
✅ Optimal: 40.0%
⚠️ Acceptable: 20.0%
❌ Suboptimal: 5.0%
❌ Overshot: 0.0%

### Estimation Accuracy
Input estimation error: 2.5%
Output estimation error: 3.8%

### Cost Comparison
Actual cost: $0.015000
If all @medium (5x): $0.018000
Savings vs default: $0.003000 (16.7%)
If all @heavy (20x): $0.033000
Savings vs heavy: $0.018000 (54.5%)
```

### Interpretação

| Campo | Significado |
|---|---|
| **Total tokens** | Soma de input, output, reasoning, cache read |
| **Total real cost** | Custo em USD (baseado em costRatio dos tiers) |
| **Average cost ratio** | Multiplicador médio usado (ex: 2.4x = entre @fast e @medium) |
| **Tier Accuracy** | % de acertos ao escolher o tier correto |
| **Estimation error** | Erro ao prever tokens (% de variação) |

---

## 2️⃣ `/token-history` — Histórico Completo

Lista todas as sessões rastreadas (memória + disco) com resumo agregado.

### Sintaxe
```
/token-history
```

### Saída Esperada
```
# Token Tracking History

**Total Sessions:** 3 (2 in memory, 1 on disk)

## Recent Sessions

| Session ID | Time | Total Tokens | Cost | Tier | Accuracy |
|---|---|---|---|---|---|
| `sess-abc123-def456` | 30min ago | 1,630 | $0.0150 | @medium | 75% |
| `sess-xyz789-aaa111` | 2h ago | 7,000 | $0.0420 | @heavy | 92% |
| `sess-pqr555-bbb222` | 5h ago | 520 | $0.0014 | @fast | 100% |

## Summary

- **Total sessions:** 3
- **Total tokens tracked:** 9,150
- **Total cost:** $0.0584
- **Average tier accuracy:** 89%
- **Most used tier:** @heavy
```

### O que significa cada coluna

| Coluna | Descrição |
|---|---|
| **Session ID** | ID único da sessão |
| **Time** | Quanto tempo atrás foi criada |
| **Total Tokens** | Soma de input + output + reasoning |
| **Cost** | Custo real estimado em USD |
| **Tier** | Tier predominante naquela sessão |
| **Accuracy** | % de acertos na classificação de tier |

### Use cases

- 📊 **Ver padrão geral:** Qual tier você mais usa?
- 🔍 **Identificar outliers:** Sessões muito caras?
- 📈 **Monitorar tendências:** Custo total subiu ou desceu?

---

## 3️⃣ `/token-compare <sessionId> <tier>` — Análise Hipotética

Compara custo real vs custo se a sessão tivesse sido inteiramente em um outro tier.

### Sintaxe
```
/token-compare <sessionId> <tier>
```

### Exemplos
```
/token-compare sess-abc123-def456 fast
/token-compare sess-abc123-def456 medium
/token-compare sess-abc123-def456 heavy
```

### Saída Esperada (exemplo com @fast)

```
## Tier Comparison: All routed to @fast

**Hypothetical scenario:** Se TODOS os passos tivessem sido feitos em @fast

| Metric | Valor |
|---|---|
| **Actual cost (mixed)** | $0.0150 |
| **Cost if all @fast (1x)** | $0.0033 |
| **Difference** | -$0.0117 |
| **Savings** | 78.0% cheaper ✅ |

📌 **Insight:** @fast teria sido 78% mais barato, mas provavelmente teria falhado em passos 2-3 (complexidade alta). Roteamento misto foi correto.

⚠️ **Trade-off:** Qualidade vs custo — @fast é muito restritivo para design/análise.
```

### Interpretar resultados

| Resultado | Significado | Ação |
|---|---|---|
| `-XX%` | Tier testado **mais barato** | Considerar se qualidade permite downgrade |
| `+XX%` | Tier testado **mais caro** | Manter roteamento atual (está bom) |
| `-78%` | **Muito** mais barato | Validar se tier mais barato teria sucesso |

### Fluxo de otimização

```
1. Termina sessão complexa
   ↓
2. /token-report sess-abc123 → custo: $0.015
   ↓
3. /token-compare sess-abc123 fast → "-78%!"
   ↓
4. Pergunta: Fez sentido usar fast?
   ├─ SIM: Ajustar taskPatterns para mais keywords @fast
   └─ NÃO: Manter roteamento atual (está otimizado)
   ↓
5. /token-history → verificar nova média de custo
```

---

## 📊 Comparação dos 3 Comandos

| Aspecto | `/token-report` | `/token-history` | `/token-compare` |
|---|---|---|---|
| **Escopo** | Uma sessão (detalhe) | Todas as sessões | Uma sessão vs tiers |
| **Output** | Markdown detalhado | Tabela resumida | Comparação de cenários |
| **Use case** | Analisar custo específico | Ver tendências gerais | Otimizar routing futuro |
| **Requer sessionId?** | ✅ Sim | ❌ Não | ✅ Sim |

---

## 💡 Fluxo de Trabalho Recomendado

### 1️⃣ Diagnóstico Inicial
```bash
/token-history          # Ver padrão geral
```

### 2️⃣ Sessão Cara?
```bash
/token-report sess-abc123    # Detalhes desta sessão
```

### 3️⃣ Poderia ser mais barato?
```bash
/token-compare sess-abc123 fast      # Testar @fast
/token-compare sess-abc123 medium    # Testar @medium
```

### 4️⃣ Otimizar
```bash
# Editar tiers.json para ajustar taskPatterns
# Exemplo: adicionar mais keywords a @fast se for viável
```

### 5️⃣ Validar
```bash
/token-history     # Nova média de custo
```

---

## 🔍 Exemplos Reais

### Cenário 1: Sessão muito cara

```
Descoberta: /token-history mostra que ultima sessao custou $0.45

Próximo passo:
  /token-report sess-xyz789
  → Resultado: 95% dos tokens foram em @heavy

Otimização:
  /token-compare sess-xyz789 medium
  → Resultado: -25% de custo se tivesse sido @medium

Conclusão:
  Tarefas "implementação" estão sendo roteadas para @heavy
  Ajustar taskPatterns para colocar "implementar" em @medium
```

### Cenário 2: Tier subutilizado

```
Descoberta: /token-history mostra 0% de uso de @fast

Investigação:
  taskPatterns.fast = ["find", "search", "read", "grep"]
  Mas usuário raramente usa esses verbos

Otimização:
  Adicionar mais keywords a @fast:
  - "locate"
  - "show"
  - "list"
  - "where"

Validação:
  /token-history após 1h de uso
  → @fast passou de 0% para 15% ✅
```

### Cenário 3: Análise de acurácia

```
Descoberta: /token-report mostra 60% acurácia de tier

Análise:
  - 30% foram overshot (usou tier maior que necessário)
  - 10% foram suboptimal (usou tier menor do que ideal)

Ação:
  Revisar keywords que causam misclassification
  Testar strategy=llm ao invés de keyword

Resultado:
  /token-history após mudanças → 85% acurácia ✅
```

---

## 📌 Lembrete Importante

O `/token-compare` é **preditivo**:
- ✅ Mostra quanto você **teria economizado**
- ⚠️ **NÃO garante** que o tier mais barato funcionaria
- 🔍 Use junto com `tierAccuracy` para tomar decisões

**Regra de ouro:** Qualidade > Custo. Se dúvida, prefira tier mais potente.

---

## 🛠️ Troubleshooting

| Problema | Solução |
|---|---|
| "No data for session X" | Sessão expirou (TTL 30min) ou nunca foi rastreada |
| Histórico vazio | Nenhuma sessão foi registrada ainda. Aguarde ou crie uma. |
| Números altos de custo | Verificar se `costRatio` em tiers.json estão corretos |
| Acurácia baixa | Revisar `taskPatterns` — palavras-chave podem estar imprecisas |

---

## 📚 Referência Rápida

```bash
# Ver custo de uma sessão
/token-report sess-abc123

# Ver todas as sessões
/token-history

# Comparar com tier específico
/token-compare sess-abc123 fast
/token-compare sess-abc123 medium
/token-compare sess-abc123 heavy

# Ajustar roteamento (editar arquivo)
# ~/.config/opencode/tiers.json ou ./tiers.json
```

