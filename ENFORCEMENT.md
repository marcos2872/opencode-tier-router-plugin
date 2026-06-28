# ENFORCEMENT.md — 100% Delegation Guarantee

## 🎯 Objetivo

Garantir que o plugin **SEMPRE delega tarefas para subagentes**, nunca permitindo execução direta na janela principal. A janela principal é apenas um **orquestrador** que classifica e roteia para os modelos apropriados.

## ✅ Regras de Enforcement

### 1. **Mode = Hard-Block (Obrigatório)**

```json
"enforcement": {
  "mode": "hard-block"  // NÃO "advisory"
}
```

- ✅ **hard-block**: Força delegação. Se classificado para @medium, DEVE delegar.
- ❌ **advisory**: Permite bypass. Modelo principal pode ignorar sugestão.

**Por quê**: Advisory permite que a janela principal execute tarefas, violando a arquitetura.

---

### 2. **trivialDirectAllowed = False (Crítico)**

```json
"enforcement": {
  "trivialDirectAllowed": false  // NUNCA true
}
```

- ✅ **false**: Até tarefas "triviais" (search, find) delegam para @fast.
- ❌ **true**: Permite tarefas simples executarem diretamente na janela principal.

**Por quê**: Sem este bloqueio, a janela principal consegue executar buscar, leitura de arquivos, etc. sem passar por subagentes.

---

### 3. **Cost Hierarchy Correta**

```json
"tiers": {
  "fast":   { "costRatio": 1  },  // 1x (cheapest)
  "medium": { "costRatio": 5  },  // 5x
  "heavy":  { "costRatio": 20 }   // 20x (most capable)
}
```

**Invariante**: `fast < medium < heavy`

Se violado → modelo barato pode fazer trabalho de modelo caro → economia falsa.

---

### 4. **Todos os 3 Tiers Configurados**

Cada tier DEVE ter:
- Modelo válido (`"provider/model"` format)
- costRatio positivo e diferente
- Cap positivo (limite de sessões)

Se falta tier → rota para um tier pode não ter modelo → fallback broken.

---

### 5. **Padrões de Tarefa Cobrindo Todos os Tiers**

```json
"taskPatterns": {
  "fast":   ["find", "search", "grep", "locate", "list", "read", ...],
  "medium": ["implement", "add", "write", "fix", "update", "create", ...],
  "heavy":  ["design", "architecture", "debug", "analyze", "review", ...]
}
```

- **fast** (≥3 padrões): Busca, exploração
- **medium** (≥5 padrões): Implementação, refatoração
- **heavy** (≥5 padrões): Design, arquitetura, debug

Sem cobertura → tarefas podem cair em "nenhum tier" → fallback inseguro.

---

## 🔍 Validação (Enforcement Validator)

Arquivo: `src/router/enforcement-validator.ts`

### Executar Validação

```typescript
import { validateEnforcement, assertEnforcement, reportEnforcement } from './enforcement-validator.js';

// Validar (retorna struct)
const validation = validateEnforcement(config);
if (!validation.isValid) {
  console.error(validation.errors);
}

// Afirmar (lança se inválido)
assertEnforcement(config); // Throws if rules violated

// Relatório (audit trail)
console.log(reportEnforcement(config));
```

### Saída de Relatório

```
═══════════════════════════════════════════════════════════════
ENFORCEMENT VALIDATION REPORT
═══════════════════════════════════════════════════════════════

Status: ✅ VALID

--- Configuration ---
enforcement.mode: hard-block
enforcement.trivialDirectAllowed: false
routing.strategy: llm
mode: normal

--- Tier Models ---
@fast:   opencode/big-pickle (1x)
@medium: llama.cpp/Nex-N2-mini (5x)
@heavy:  llama.cpp/Nex-N2-mini (20x)

✅ All checks passed! Plugin enforces 100% delegation to subagents.
═══════════════════════════════════════════════════════════════
```

---

## 🚫 Violações Detectadas

| Violação | Erro | Impacto |
|----------|------|--------|
| `enforcement.mode != "hard-block"` | ❌ CRITICAL | Janela principal pode ignorar routing |
| `trivialDirectAllowed = true` | ❌ CRITICAL | Tarefas "triviais" executam diretamente |
| Tier faltando | ❌ CRITICAL | Rota quebrada sem modelo |
| Modelo inválido `"xyzzy"` | ❌ CRITICAL | Fallback quebrado |
| Cost não crescente | ❌ CRITICAL | Economia falsa |
| `costRatio <= 0` | ❌ CRITICAL | Cálculo de cost quebrado |
| Poucos padrões de tarefa | ⚠️ WARNING | Rota cai em default arriscado |

---

## 📊 Configuração Padrão (Segura)

### `tiers.json`

```json
{
  "enforcement": {
    "mode": "hard-block",
    "trivialDirectAllowed": false
  },
  "tiers": {
    "fast": {
      "model": "opencode/big-pickle",
      "costRatio": 1,
      "cap": 8
    },
    "medium": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 5,
      "cap": 12
    },
    "heavy": {
      "model": "llama.cpp/Nex-N2-mini",
      "costRatio": 20,
      "cap": 20
    }
  },
  "routing": {
    "strategy": "keyword",
    "selectorModel": "opencode/big-pickle",
    "selectorTimeoutMs": 1200,
    "selectorMaxTokens": 16
  }
}
```

---

## 🔒 Garantias Arquiteturais

### Janela Principal (OpenCode)

```
┌──────────────────────────────────────┐
│  Main Window (User Input)            │
│                                      │
│  - Chat.message hook                 │
│  - Classify task → @tier             │
│  - System.transform hook             │
│  - Injects hard-block message        │
│  - Permission.ask hook               │
│  - DENY all tools if hard-blocked    │
│  - Event hook: reject permission     │
│                                      │
│  ❌ NUNCA executa tarefas             │
│  ✅ SEMPRE delega a subagentes        │
└──────┬───────────────────────────────┘
       │ delegation via task()
       ├──→ @fast   [1x cost]
       ├──→ @medium [5x cost]
       └──→ @heavy  [20x cost]
```

### Subagentes

```
┌──────────────────────────────────────┐
│  Subagent @fast/@medium/@heavy       │
│                                      │
│  - Recebe protocolo INFORMATIVO       │
│    (só tiers, custos, regras)        │
│  - NÃO recebe hard-block message     │
│  - Permissions: ALLOW para todas     │
│    as ferramentas                    │
│  - NÃO pode delegar via task()       │
│    (protocolo informativo proíbe)    │
│                                      │
│  ✅ EXECUTA tarefas diretamente       │
│  ❌ NÃO delega para outro subagente   │
└──────────────────────────────────────┘
```

### Hard-Block Logic

```typescript
// chat.message hook
if (!enabled) return;
const cfg = await loadConfig(...);
const selection = await selectTierByStrategy(text, cfg);
const desiredTier = selection.tier;

// Mark session as hard-blocked
if (cfg.enforcement.mode === 'hard-block') {
  hardBlockedSessions.set(input.sessionID, desiredTier);
  hardBlockReasons.set(input.sessionID, `This request requires @${desiredTier}.`);
}

// permission.ask hook — runs BEFORE the permission dialog
if (subagentSessions.has(sessionID)) {
  output.status = 'allow';  // Subagent → auto-allow, no dialog
} else if (hardBlockedSessions.has(sessionID)) {
  output.status = 'deny';   // Hard-blocked → deny, no dialog
}

// event hook — runs AFTER permission is asked (permission.asked event)
if (hardBlockedSessions.has(sessionID)) {
  // Reject + show toast notification
  client.postSessionIdPermissionsPermissionId({
    path: { id: sessionID, permissionID: props.id },
    body: { response: 'reject' }
  });
  client.tui.showToast({
    body: {
      message: `[Router] Tool blocked. Delegate to @${tier} via task().`,
      variant: 'error',
      duration: 8000
    }
  });
} else {
  // Auto-allow once for all other sessions (subagent + normal)
  client.postSessionIdPermissionsPermissionId({
    path: { id: sessionID, permissionID: props.id },
    body: { response: 'once' }
  });
}

// system.transform hook — injects instructions
output.system.push(buildDelegationProtocol(cfg)); // Informational: all sessions

const tier = hardBlockedSessions.get(sessionID);
if (cfg.enforcement.mode === 'hard-block' && tier) {
  output.system.push(buildHardBlockMessage(tier)); // Strong: only hard-blocked main
}
```

### Two-Level Prompt Strategy

| Prompt | Conteúdo | Quem recebe |
|--------|----------|-------------|
| `buildDelegationProtocol` | Referência info: tiers, custos, regras. **Sem** "MUST delegate" ou "BLOCKED TOOLS" | **Todas** as sessões (main + subagentes) |
| `buildHardBlockMessage` | "ALL TOOLS EXCEPT task ARE DENIED", "YOU ARE A ROUTER" | **Só** sessões hard-blocked (main session) |

A separação garante que subagentes **nunca** recebam instruções conflitantes — eles usam ferramentas diretamente sem tentar delegar.

---

## ✅ Testes (27 + 163 existentes)

### Cobertura Crítica

- ✅ Rejeita `mode: "advisory"`
- ✅ Rejeita `trivialDirectAllowed: true`
- ✅ Rejeita tiers faltantes
- ✅ Rejeita modelos inválidos
- ✅ Rejeita cost hierarchy quebrada
- ✅ Avisa padrões esparsos
- ✅ Funciona `assertEnforcement()` (lança se inválido)
- ✅ Gera `reportEnforcement()` (audit)

Rodar:

```bash
npm run typecheck
npx vitest run test/enforcement-validator.spec.ts
```

---

## 🛡️ Como Usar (Para Operadores)

### ✅ Validar Configuração

```bash
# No início da sessão
npm run typecheck
npx vitest run test/enforcement-validator.spec.ts
```

Esperar "✅ All 27 tests passed".

### ✅ Audit Compliance

```typescript
// Em qualquer ponto do plugin
const report = reportEnforcement(cfg);
console.log(report);
// Esperar: "✅ All checks passed! Plugin enforces 100% delegation"
```

### ✅ Integração com CI/CD

```yaml
# .github/workflows/test.yml
- name: Validate Enforcement
  run: npx vitest run test/enforcement-validator.spec.ts
  # Falha se alguma rule violated
```

---

## 📝 Checklist de Segurança

Antes de fazer deploy:

- [ ] `enforcement.mode = "hard-block"` ✅
- [ ] `trivialDirectAllowed = false` ✅
- [ ] Todos 3 tiers têm modelos válidos ✅
- [ ] Cost hierarchy: 1 < 5 < 20 ✅
- [ ] Task patterns têm ≥3/≥5/≥5 itens ✅
- [ ] `reportEnforcement()` mostra "✅ VALID" ✅
- [ ] Todos os testes passam ✅

---

## 🚨 Se Algo Quebrar

1. **Erro de validação**: Ler mensagem de erro → cada linha é específica
2. **Config faltando**: Copiar `tiers.json` padrão da raiz
3. **Teste falhando**: Rodar `reportEnforcement()` → ver qual rule violou
4. **Advisory mode ligado**: MUDAR PARA `hard-block` IMEDIATAMENTE
5. **Subagente delegando**: Verificar se `buildDelegationProtocol` contém "MUST delegate" — se sim, remover (deve ser só informativo)

---

## 📚 Referência

- `src/router/enforcement-validator.ts` — Lógica de validação
- `src/prompts.ts` — `buildDelegationProtocol` (info) e `buildHardBlockMessage` (hard-block)
- `src/plugin-orchestrator.ts` — Hook orchestration (permission.ask, event)
- `test/enforcement-validator.spec.ts` — Testes completos
- `src/index.ts` (config hook) — Plugin init
- `tiers.json` — Config example

---

**Garantia**: Com estas regras e validação em place, o plugin **SEMPRE delega a subagentes**. Nenhuma tarefa escapa.
