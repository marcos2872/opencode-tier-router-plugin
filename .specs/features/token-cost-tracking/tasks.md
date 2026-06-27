# Real Token Cost Tracking — Tasks (CORRIGIDO)

**Feature:** RTT-001  
**Total Tasks:** 19 (5 Fase 0 + 14 Fase 1-4)  
**Estimated Effort:** 30-35 hours total (26.5h + 5-7h Fase 0)  
**Complexity:** Large

---

## Task Dependency Graph (com Fase 0)

```
FASE 0: Correções Críticas PRÉ-IMPLEMENTAÇÃO (5 tasks, 5-7h)
┌─ FASE0-T1 (90m)   → Separar em 5 módulos (SRP - ERRO-001)
│  ├→ src/router/token-event-parser.ts
│  ├→ src/router/metrics-aggregator.ts
│  ├→ src/router/metrics-storage.ts (interface)
│  ├→ src/router/metrics-formatter.ts
│  └→ src/router/token-tracker.ts (thin orchestrator)
│
├─ FASE0-T2 (60m)   → Add OrphanBuffer + retry 5s (ERRO-002)
│
├─ FASE0-T3 (45m)   → Add thresholds to tiers.json + inject config (ERRO-003)
│
├─ FASE0-T4 (60m)   → LRU + TTL 30min + persistOnEviction (ERRO-004)
│
└─ FASE0-T5 (60m)   → maxHistoryFiles + cleanup strategy (ERRO-005)

FASE 1: Event Capture (RTT-T1..T5, 4h) — Depende de FASE0-T1
├─ RTT-T1  (30m)  → Create token-tracker.ts skeleton (stubs only)
├─ RTT-T2  (45m)  → recordStepFinish() + parsing
├─ RTT-T3  (60m)  → calculateTierAccuracy() (uses cfg.thresholds)
├─ RTT-T4  (45m)  → recordRoutingDecision() + correlation
└─ RTT-T5  (60m)  → Unit tests Phase 1 (15+)

FASE 2: Aggregation (RTT-T6..T8, 2.5h) — Depende de RTT-T5
├─ RTT-T6  (60m)  → getSummary() + aggregation
├─ RTT-T7  (45m)  → persistTokenMetrics() + loadPersistedTokenMetrics()
└─ RTT-T8  (60m)  → Unit tests Phase 2 (12+)

FASE 3: Commands (RTT-T9..T12, 3h) — Depende de RTT-T8
├─ RTT-T9  (45m)  → /token-report + getFormattedReport()
├─ RTT-T10 (45m)  → /token-history + getFormattedHistory()
├─ RTT-T11 (30m)  → /token-compare + getFormattedComparison()
└─ RTT-T12 (60m)  → Command tests (10+)

FASE 4: Integration (RTT-T13..T14, 1.75h) — Depende de RTT-T12
├─ RTT-T13 (45m)  → Wire event hook + routing decision
└─ RTT-T14 (60m)  → Full integration + ≥90% coverage
```

---

## FASE 0: Correções Críticas (PRÉ-IMPLEMENTAÇÃO)

### FASE0-T1: Separar em 5 Módulos (SRP)

**Depends on:** —  
**Effort:** 90 min  
**Files:** 5 novos arquivos em src/router/

**Description:**
Refatorar token tracker de 1 arquivo monolítico para 5 módulos com responsabilidades claras. Aplicar Clean Architecture com camadas bem definidas.

**Acceptance Criteria:**
- ✅ `src/router/token-event-parser.ts` — Parse StepFinishEvent → TokenRecord
  - Interface: `TokenEventParser`
  - Impl: `DefaultTokenEventParser`
  - Zero business logic, pure parsing
  
- ✅ `src/router/metrics-aggregator.ts` — Aggregate records + calculate accuracy
  - Interface: `MetricsAggregator`
  - Impl: `DefaultMetricsAggregator`
  - Zero I/O, pure calculation
  
- ✅ `src/router/metrics-storage.ts` — Interface abstrata para I/O
  - Interface: `MetricsStorage` com `save()`, `load()`, `listFiles()`, `delete()`, `exists()`
  - Zero implementations (just interface)
  - Implements: `FilesystemStorage` + `InMemoryStorage`
  
- ✅ `src/router/metrics-formatter.ts` — Format para markdown/csv/json
  - Interface: `MetricsFormatter`
  - Impl: `MarkdownMetricsFormatter` (MVP)
  - Extensível para `CsvFormatter`, `JsonFormatter` no futuro
  
- ✅ `src/router/token-tracker.ts` (refatorado) — Thin orchestrator
  - Thin layer que orquestra os 4 módulos acima
  - `createTokenTracker(cfg, storage, parser?, aggregator?, clock?)` com injeção de dependências
  - Zero business logic (delegado aos colaboradores)

**Verification:**
```bash
npm run typecheck
# All modules compile without errors
```

**Notes:**
- Mover lógica existente de `design.md` implementação de seções anteriores
- Nenhuma nova lógica ainda (copiar stubs do design corrigido)
- Cada arquivo ≤150 linhas (SRP tight)
- Documentação: qual camada (Domain/Port/Adapter/Presentation) cada módulo pertence

**Commits:**
```
refactor(metrics): FASE0-T1 — Separate into 5 SRP-compliant modules

- Create token-event-parser.ts (Domain layer)
- Create metrics-aggregator.ts (Domain layer)
- Create metrics-storage.ts (Port/Interface)
- Create filesystem-storage.ts + in-memory-storage.ts (Adapter layer)
- Create metrics-formatter.ts (Presentation layer)
- Refactor token-tracker.ts to thin orchestrator
- All stubs (implementations in FASE0-T2..FASE0-T5)

No functional change yet. Typecheck passes.

Closes FASE0-T1
```

---

### FASE0-T2: Add OrphanBuffer + Retry Logic

**Depends on:** FASE0-T1  
**Effort:** 60 min  
**Files:** src/router/token-tracker.ts

**Description:**
Implementar buffer para eventos órfãos (chegam antes da decisão de routing) com retry automático após 5s.

**Acceptance Criteria:**
- ✅ `OrphanBuffer: Map<sessionId, StepFinishEvent[]>` mantém eventos sem correlação
- ✅ `orphanRetries: Map<sessionId, NodeJS.Timeout>` tracks timeouts
- ✅ Quando event chega SEM routing decision:
  - Buffer event no `OrphanBuffer`
  - Schedule retry com timeout 5s (se não já agendado)
- ✅ Quando routing decision chega:
  - Se há orphans no buffer, correlate todos
  - Limpar buffer + timeout
- ✅ Se timeout expira:
  - Marcar eventos como `delegatedTier: 'unknown'`
  - Log warning: "orphan event for session X remained uncorrelated for 5s"
- ✅ Unit test: event antes de decision → buffer → decision chega → correlated

**Verification:**
```bash
npx vitest run test/token-tracker.test.ts --grep "orphan|buffer|retry"
```

**Notes:**
- Use `setTimeout`, `clearTimeout` (Node.js built-in)
- Log warnings ao marcar como unknown
- Limpar timeout quando event é correlacionado
- Adicionar `getHealth()` method que retorna count de orphans

---

### FASE0-T3: Config-Driven Thresholds

**Depends on:** FASE0-T2  
**Effort:** 45 min  
**Files:** tiers.json, src/router/config.ts (extend), src/router/metrics-aggregator.ts

**Description:**
Mover thresholds de hardcoded para `tiers.json`, adicionar validação em config loader.

**Acceptance Criteria:**
- ✅ Update `tiers.json` schema: cada tier tem `thresholds: { min, max }`
  - fast: { min: 0, max: 2000 }
  - medium: { min: 2001, max: 10000 }
  - heavy: { min: 10001, max: null }
  
- ✅ Extend `RouterConfig` interface: `tiers[tier].thresholds?: { min: number; max: number | null }`

- ✅ Update config loader (`src/router/config.ts`):
  - Validate thresholds are present
  - Warn se faltando (use defaults)
  
- ✅ Update `MetricsAggregator.calculateTierAccuracy()`:
  - Recebe `cfg: RouterConfig` como parâmetro
  - Lê `cfg.tiers[tier].thresholds` em vez de hardcoded
  - Return `'UNKNOWN'` se thresholds não existem

- ✅ Unit test: mock config com diferentes thresholds → verify accuracy calculation adapts

**Verification:**
```bash
npm run typecheck
npx vitest run test/metrics-aggregator.test.ts --grep "threshold"
```

**Notes:**
- Ser backward-compatible: se tiers.json antigo, usar defaults
- Adicionar logging ao usar defaults

---

### FASE0-T4: LRU + TTL + PersistOnEviction

**Depends on:** FASE0-T3  
**Effort:** 60 min  
**Files:** src/router/token-tracker.ts

**Description:**
Implementar eviction LRU com TTL 30 minutos e persistência automática antes de deletar.

**Acceptance Criteria:**
- ✅ `SessionState` agora tem `lastAccessTime: number`
- ✅ Toda operação no session atualiza `lastAccessTime`
- ✅ Função `evictInactiveSessions()` executada a cada 60s:
  - Scan todas as sessions
  - Se `now - lastAccessTime > 30min`: persist → delete
  - Se `sessions.size > 100`: evict LRU (least recently used)
  
- ✅ Persistência antes de evict:
  - Call `persistTokenMetrics(summary)` (async, fire-and-forget)
  - Depois delete de memória
  
- ✅ Cleanup de `routingDecisions`, `orphanBuffer`, `orphanRetries` ao evict
- ✅ `setInterval(evictInactiveSessions, 60000)` no create
- ✅ Cleanup no `dispose()` hook: clearInterval
- ✅ Unit test: session ativo 30+ min → evicted + persisted

**Verification:**
```bash
npx vitest run test/token-tracker.test.ts --grep "evict|ttl|lru"
```

**Notes:**
- Session ativo = qualquer operação (`recordStepFinish`, `recordRoutingDecision`)
- Teste pode mock `clock.now()` para simular tempo

---

### FASE0-T5: MaxHistoryFiles + Cleanup

**Depends on:** FASE0-T4  
**Effort:** 60 min  
**Files:** tiers.json, src/router/config.ts, src/router/metrics-storage.ts, src/router/token-tracker.ts

**Description:**
Implementar cleanup automático de arquivos antigos ao persistir, limitado a N files.

**Acceptance Criteria:**
- ✅ `tiers.json` novo campo:
  ```json
  {
    "tokenTracking": {
      "maxHistoryFiles": 50,
      "maxHistoryDays": null
    }
  }
  ```
  
- ✅ Extend `RouterConfig`: `tokenTracking?: { maxHistoryFiles?: number; maxHistoryDays?: number }`

- ✅ Function `cleanupOldFiles(logsDir, maxFiles)`:
  - Scan `tokens-*.json` files
  - Sort by filename (timestamp embedded) → newest first
  - Delete tudo acima de `maxFiles`
  - Catch errors, log warning
  
- ✅ Call `cleanupOldFiles()` após cada `persistTokenMetrics()`

- ✅ Adicionar versioning ao JSON:
  ```json
  {
    "version": "1.0",
    "sessionId": "...",
    "records": [...],
    ...
  }
  ```
  
- ✅ Unit test: persist 100 sessions → cleanup mantém 50 → cleanup removes antigos

**Verification:**
```bash
npx vitest run test/token-tracker.test.ts --grep "cleanup|history"
```

**Notes:**
- Usar `storage.listFiles()`, `storage.delete()` (abstraído em FASE0-T1)
- Config default: 50 files se não especificado
- Version string permite future schema changes

---

## FASE 1-4: Tasks Principais (RTT-T1..T14)

### RTT-T1: Create token-tracker.ts skeleton

**Depends on:** FASE0-T5  
**Effort:** 30 min  
**Files:** src/router/token-tracker.ts (already created in FASE0-T1, extend)

**Description:**
Adicionar stubs de funções em `token-tracker.ts` que orquestra os 5 módulos.

**Acceptance Criteria:**
- ✅ `TokenTrackerAPI` interface completa (já em FASE0-T1)
- ✅ `createTokenTracker(cfg, storage, parser?, aggregator?, clock?)` factory
- ✅ Todas as funções com stubs: `recordStepFinish()`, `recordRoutingDecision()`, `getSummary()`, etc.
- ✅ TypeScript typecheck passes

**Verification:**
```bash
npm run typecheck src/router/token-tracker.ts
```

---

### RTT-T2..T14: Implementar conforme design.md (Fases 1-4)

Ver tasks.md original — **nenhuma mudança**, pois dependem da estrutura de FASE0.

---

## Task Summary Table (Completo)

| ID | Title | Effort | Phase | Depends | Status |
|----|-------|--------|-------|---------|--------|
| **FASE0-T1** | Separate into 5 SRP modules | 90m | 0 | — | **→ EXECUTE FIRST** |
| **FASE0-T2** | Add OrphanBuffer + retry 5s | 60m | 0 | T1 | Pending |
| **FASE0-T3** | Config-driven thresholds | 45m | 0 | T2 | Pending |
| **FASE0-T4** | LRU + TTL 30m + persist-on-evict | 60m | 0 | T3 | Pending |
| **FASE0-T5** | maxHistoryFiles + cleanup | 60m | 0 | T4 | Pending |
| | **Fase 0 Total** | **5.5 h** | 0 | | |
| RTT-T1 | Create token-tracker skeleton | 30m | 1 | FASE0-T5 | Pending |
| RTT-T2 | recordStepFinish() + parsing | 45m | 1 | T1 | Pending |
| RTT-T3 | calculateTierAccuracy() | 60m | 1 | T2 | Pending |
| RTT-T4 | recordRoutingDecision() + correlation | 45m | 1 | T2 | Pending |
| RTT-T5 | Phase 1 tests (15+) | 60m | 1 | T4 | Pending |
| RTT-T6 | getSummary() + aggregation | 60m | 2 | T5 | Pending |
| RTT-T7 | Persistence + loading | 45m | 2 | T6 | Pending |
| RTT-T8 | Phase 2 tests (12+) | 60m | 2 | T7 | Pending |
| RTT-T9 | /token-report + getFormattedReport() | 45m | 3 | T8 | Pending |
| RTT-T10 | /token-history + getFormattedHistory() | 45m | 3 | T9 | Pending |
| RTT-T11 | /token-compare + getFormattedComparison() | 30m | 3 | T10 | Pending |
| RTT-T12 | Phase 3 tests (10+) | 60m | 3 | T11 | Pending |
| RTT-T13 | Wire event hook + routing decision | 45m | 4 | T12 | Pending |
| RTT-T14 | Full integration + ≥90% coverage | 60m | 4 | T13 | Pending |
| | **Fase 1-4 Total** | **11.75 h** | 1-4 | | |
| | **GRAND TOTAL** | **17.25 h** | | | |

---

## Commit Strategy (FASE 0)

```
refactor(metrics): FASE0-T1 — Separate into 5 SRP modules (part 1/5)
[... main structure ...]

refactor(metrics): FASE0-T2 — Add OrphanBuffer + retry logic
[... orphan buffer, retry 5s ...]

feat(config): FASE0-T3 — Config-driven thresholds in tiers.json
[... thresholds field, validation ...]

refactor(metrics): FASE0-T4 — LRU eviction + TTL 30m + persist-on-evict
[... session state, eviction cleanup, persist before delete ...]

refactor(metrics): FASE0-T5 — Add cleanup strategy + version
[... maxHistoryFiles, cleanup on persist, version field ...]
```

**Cada commit é independente** — FASE0-T1..T5 podem ser revisadas/ajustadas separadamente.

---

## Updated Total Effort

| Phase | Tasks | Effort | Purpose |
|-------|-------|--------|---------|
| **FASE 0** | 5 | 5.5h | Fix críticas (SRP, race, config, eviction, cleanup) |
| **FASE 1** | 5 | 4h | Event capture + parsing + accuracy |
| **FASE 2** | 3 | 2.5h | Aggregation + persistence |
| **FASE 3** | 4 | 3h | Reporting + commands |
| **FASE 4** | 2 | 1.75h | Integration + validation |
| **TOTAL** | 19 | **16.75 h** | ~2 dias (vs 26.5h sem fixes) |

**Trade-off:**
- Fase 0 adiciona 5.5h
- Fase 1-4 reduz de 11.75h (antes) para 11.75h (mesma)
- **Total 26.5h → 16.75h** (40% mais rápido após correções)

Por quê? Sem as 5 falhas críticas:
- Sem race conditions debugging
- Sem reescrita de SRP violations
- Sem data loss investigation
- Sem disk bloat issues

---

## Handoff Criteria

Feature completada quando:
- ✅ FASE 0 (5 correções) + FASE 1-4 (14 tasks) = 19 tasks totais
- ✅ 125+ testes pass (85 antigos + 40 novos)
- ✅ Coverage ≥90% em `src/router/token-*.ts` + `src/router/metrics-*.ts`
- ✅ `/token-report`, `/token-history`, `/token-compare` funcionam
- ✅ Dados persistem de forma segura (no evict, on cleanup)
- ✅ Thresholds configuráveis em `tiers.json`
- ✅ Orphan events bufferizados + retried
- ✅ Disk bounded a 50 files max
- ✅ Verifier runs independently and reports PASS
