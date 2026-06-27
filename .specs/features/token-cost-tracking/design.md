# Real Token Cost Tracking — Design Document (CORRIGIDO)

**Feature:** RTT-001 Real Token Tracking  
**Component:** Token Event Capture & Analytics  
**Status:** Design Phase (Revisado com correções críticas)  
**Complexity:** Large  
**Última Atualização:** 2026-06-27 (Post-Review)

---

## Architecture Overview (Revisado)

```
┌──────────────────────────────────────────────────────────────┐
│  OpenCode Session                                            │
│  - User sends request                                        │
│  - Model processes (Anthropic/OpenAI/GitHub Copilot)         │
│  - Returns response with token usage                         │
│  - Emits step-finish event                                   │
└──────────────────┬───────────────────────────────────────────┘
                   │ event: { type: 'step-finish', tokens: {...}, cost: N }
                   ↓
┌──────────────────────────────────────────────────────────────┐
│  Plugin Event Hook (src/index.ts)                            │
│  - Receives step-finish event                               │
│  - Looks up routing decision from sessionId                  │
│  - Delegates to tokenTracker.recordStepFinish()              │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ↓
┌──────────────────────────────────────────────────────────────┐
│  TokenTracker Singleton (src/router/token-tracker.ts)        │
│  ✅ SEPARADO EM CAMADAS (ERRO-001 CORRIGIDO):                │
│                                                              │
│  ├─ recordStepFinish() → TokenEventParser                   │
│  ├─ recordRoutingDecision() + orphan buffer (ERRO-002 FIX)  │
│  ├─ calculateAccuracy() → MetricsAggregator                 │
│  ├─ getSummary() → MetricsAggregator                        │
│  ├─ persistTokenMetrics() → MetricsStorage (DIP)            │
│  ├─ loadPersistedTokenMetrics() → MetricsStorage            │
│  └─ cleanup on eviction + LRU TTL (ERRO-004/005 FIX)        │
│                                                              │
│  Componentes:                                                │
│  - TokenEventParser (src/router/token-event-parser.ts)      │
│  - MetricsAggregator (src/router/metrics-aggregator.ts)     │
│  - MetricsStorage (src/router/metrics-storage.ts)           │
│  - MetricsFormatter (src/router/metrics-formatter.ts)       │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ↓ (on-demand)
┌──────────────────────────────────────────────────────────────┐
│  Reports & Commands                                          │
│  - /token-report — real usage + accuracy                     │
│  - /token-history — list past sessions                       │
│  - /token-compare <tier> — hypotheticals                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Module Structure (Corrigido — ERRO-001)

**Antes (violava SRP):**
- 1 arquivo (`token-tracker.ts`) com 6 responsabilidades

**Depois (SRP adherent):**

```
src/router/
├─ token-tracker.ts           # Orquestração (main API)
├─ token-event-parser.ts      # Parse StepFinishEvent → TokenRecord
├─ metrics-aggregator.ts      # Aggregate records → SessionMetrics
├─ metrics-storage.ts         # Interface abstrata para I/O
├─ filesystem-storage.ts      # Implementação: filesystem
├─ in-memory-storage.ts       # Implementação: teste
└─ metrics-formatter.ts       # Formata para markdown/csv/json
```

### Camadas (Clean Architecture)

#### 1. **Domain Layer** (`token-event-parser.ts` + `metrics-aggregator.ts`)

```typescript
// ✅ Zero dependencies, pure business logic

export interface TokenEventParser {
  parse(event: StepFinishEvent, routingDecision?: RoutingDecision): TokenRecord;
}

export class DefaultTokenEventParser implements TokenEventParser {
  parse(event: StepFinishEvent, routingDecision?: RoutingDecision): TokenRecord {
    const totalTokensUsed = event.tokens.input + 
                           event.tokens.output + 
                           event.tokens.reasoning + 
                           event.tokens.cache.read;
    
    return {
      sessionId: event.sessionID,
      timestamp: event.timestamp ?? Date.now(),
      actualTokens: event.tokens,
      realCost: event.cost,
      delegatedTier: routingDecision?.tier ?? 'unknown',
      modelUsed: 'unknown', // will be enriched from context
      estimatedTokens: routingDecision?.estimated,
      estimatedCost: routingDecision?.estimated && routingDecision.costRatio
        ? routingDecision.costRatio * (routingDecision.estimated.input + routingDecision.estimated.output) / 1000
        : undefined,
      tierAccuracy: 'UNKNOWN',
      estimationError: { input: 0, output: 0 },
      totalTokensUsed,
    };
  }
}

export interface MetricsAggregator {
  calculateTierAccuracy(totalTokens: number, tier: string, cfg: RouterConfig): TierAccuracy;
  aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary;
}

export class DefaultMetricsAggregator implements MetricsAggregator {
  calculateTierAccuracy(totalTokens: number, tier: string, cfg: RouterConfig): TierAccuracy {
    // ✅ ERRO-003 CORRIGIDO: Use config thresholds
    const tierCfg = cfg.tiers[tier as TierName];
    if (!tierCfg?.thresholds) return 'UNKNOWN';
    
    const { min, max } = tierCfg.thresholds;
    
    if (totalTokens < min) {
      return tier === 'fast' ? 'RIGHT' : 'ACCEPTABLE';
    } else if (totalTokens <= max) {
      return 'RIGHT';
    } else {
      return tier === 'heavy' ? 'ACCEPTABLE' : 'OVERSHOT';
    }
  }

  aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary {
    if (records.length === 0) {
      return {
        sessionId: 'unknown',
        records: [],
        startTime: 0,
        endTime: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        totalCacheCost: 0,
        totalCostReal: 0,
        accuracyBreakdown: { optimal: 0, right: 0, acceptable: 0, suboptimal: 0, overshot: 0 },
        averageInputEstimationError: 0,
        averageOutputEstimationError: 0,
        costSavedVsDefault: 0,
        costSavedVsHeavy: 0,
        averageActualCostRatio: 0,
      };
    }

    // Aggregate all records
    const totalInputTokens = records.reduce((sum, r) => sum + r.actualTokens.input, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.actualTokens.output, 0);
    const totalReasoningTokens = records.reduce((sum, r) => sum + r.actualTokens.reasoning, 0);
    const totalCacheCost = records.reduce((sum, r) => sum + r.actualTokens.cache.read, 0);
    const totalCostReal = records.reduce((sum, r) => sum + r.realCost, 0);

    // Accuracy breakdown
    const accuracyBreakdown = {
      optimal: (records.filter(r => r.tierAccuracy === 'OPTIMAL').length / records.length) * 100,
      right: (records.filter(r => r.tierAccuracy === 'RIGHT').length / records.length) * 100,
      acceptable: (records.filter(r => r.tierAccuracy === 'ACCEPTABLE').length / records.length) * 100,
      suboptimal: (records.filter(r => r.tierAccuracy === 'SUBOPTIMAL').length / records.length) * 100,
      overshot: (records.filter(r => r.tierAccuracy === 'OVERSHOT').length / records.length) * 100,
    };

    // Estimation error (if available)
    const recordsWithEstimates = records.filter(r => r.estimatedTokens);
    const averageInputEstimationError = recordsWithEstimates.length > 0
      ? recordsWithEstimates.reduce((sum, r) => sum + r.estimationError.input, 0) / recordsWithEstimates.length
      : 0;
    const averageOutputEstimationError = recordsWithEstimates.length > 0
      ? recordsWithEstimates.reduce((sum, r) => sum + r.estimationError.output, 0) / recordsWithEstimates.length
      : 0;

    // Cost comparison
    const totalTokens = totalInputTokens + totalOutputTokens;
    const costIfAllDefault = (5 * totalTokens) / 1000; // medium = 5x
    const costIfAllHeavy = (20 * totalTokens) / 1000;

    const totalCostRatioUsed = records.reduce((sum, r) => {
      const ratio = cfg.tiers[r.delegatedTier as TierName]?.costRatio ?? 1;
      return sum + ratio;
    }, 0);
    const averageActualCostRatio = records.length > 0 ? totalCostRatioUsed / records.length : 0;

    return {
      sessionId: records[0].sessionId,
      records,
      startTime: Math.min(...records.map(r => r.timestamp)),
      endTime: Math.max(...records.map(r => r.timestamp)),
      totalInputTokens,
      totalOutputTokens,
      totalReasoningTokens,
      totalCacheCost,
      totalCostReal,
      accuracyBreakdown,
      averageInputEstimationError,
      averageOutputEstimationError,
      costSavedVsDefault: costIfAllDefault - totalCostReal,
      costSavedVsHeavy: costIfAllHeavy - totalCostReal,
      averageActualCostRatio,
    };
  }
}
```

#### 2. **Port/Interface Layer** (`metrics-storage.ts`)

```typescript
// ✅ DIP: Define interface, not concrete implementation

export interface MetricsStorage {
  save(filename: string, content: string): Promise<void>;
  load(filename: string): Promise<string>;
  listFiles(dir: string): Promise<string[]>;
  delete(filename: string): Promise<void>;
  exists(filename: string): Promise<boolean>;
}

// Implementations (swappable for tests)
```

#### 3. **Adapter Layer** (`filesystem-storage.ts` + `in-memory-storage.ts`)

```typescript
// ✅ Concrete implementations, testable

export class FilesystemStorage implements MetricsStorage {
  async save(filename: string, content: string): Promise<void> {
    const dir = dirname(filename);
    await mkdir(dir, { recursive: true });
    await writeFile(filename, content);
  }

  async load(filename: string): Promise<string> {
    return await readFile(filename, 'utf-8');
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  async delete(filename: string): Promise<void> {
    await unlink(filename);
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await stat(filename);
      return true;
    } catch {
      return false;
    }
  }
}

export class InMemoryStorage implements MetricsStorage {
  private files = new Map<string, string>();

  async save(filename: string, content: string): Promise<void> {
    this.files.set(filename, content);
  }

  async load(filename: string): Promise<string> {
    return this.files.get(filename) ?? '';
  }

  async listFiles(dir: string): Promise<string[]> {
    return [...this.files.keys()].filter(f => f.startsWith(dir));
  }

  async delete(filename: string): Promise<void> {
    this.files.delete(filename);
  }

  async exists(filename: string): Promise<boolean> {
    return this.files.has(filename);
  }
}
```

#### 4. **Presentation Layer** (`metrics-formatter.ts`)

```typescript
// ✅ OCP: Add new formats without modifying domain

export interface MetricsFormatter {
  formatReport(summary: SessionTokenSummary): string;
  formatHistory(sessions: PersistedTokenSession[]): string;
  formatComparison(summary: SessionTokenSummary, tier: TierName): string;
}

export class MarkdownMetricsFormatter implements MetricsFormatter {
  formatReport(summary: SessionTokenSummary): string {
    // ... markdown format
  }
  // ...
}

export class CsvMetricsFormatter implements MetricsFormatter {
  formatReport(summary: SessionTokenSummary): string {
    // ... csv format
  }
  // ...
}
```

#### 5. **Orchestration Layer** (`token-tracker.ts`)

```typescript
// ✅ Thin orchestrator, delegates to collaborators

export interface TokenTrackerAPI {
  recordStepFinish(event: StepFinishEvent): void;
  recordRoutingDecision(sessionId: string, tier: TierName, estimated: { input: number; output: number }): void;
  getSummary(sessionId: string): SessionTokenSummary;
  persistTokenMetrics(summary: SessionTokenSummary): Promise<void>;
  loadPersistedTokenMetrics(): Promise<PersistedTokenSession[]>;
  getFormattedReport(summary: SessionTokenSummary, formatter: MetricsFormatter): string;
  getFormattedHistory(sessions: PersistedTokenSession[], formatter: MetricsFormatter): string;
}

export function createTokenTracker(
  cfg: RouterConfig,
  storage: MetricsStorage,
  parser: TokenEventParser = new DefaultTokenEventParser(),
  aggregator: MetricsAggregator = new DefaultMetricsAggregator(),
  clock = { now: () => Date.now() }, // ✅ SUGESTÃO-008: Injected clock
): TokenTrackerAPI {
  const sessions: Map<string, SessionState> = new Map();
  const routingDecisions: Map<string, RoutingDecision> = new Map();
  const orphanBuffer: Map<string, StepFinishEvent[]> = new Map();
  const orphanRetries: Map<string, NodeJS.Timeout> = new Map();

  const MAX_IN_MEMORY_SESSIONS = 100;
  const ORPHAN_RETRY_TIMEOUT = 5000; // 5 seconds
  const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

  // ... implementation with all fixes
}
```

---

## Fixes Integrados

### ✅ ERRO-001 (SRP): Camadas Separadas

**Antes:** 1 arquivo com 600 linhas, 6 responsabilidades  
**Depois:** 5 arquivos, cada um com 1 responsabilidade clara  
**Benefício:** Testabilidade, manutenibilidade, extensibilidade

---

### ✅ ERRO-002 (Race Condition): OrphanBuffer

```typescript
interface OrphanBuffer {
  events: Map<sessionId, StepFinishEvent[]>;
  retries: Map<sessionId, NodeJS.Timeout>;
  maxRetryTime: number; // 5000ms
}

function recordStepFinish(event: StepFinishEvent, tier: string): void {
  const routing = routingDecisions.get(event.sessionID);
  
  if (!routing) {
    // Evento órfão → buffer por 5s
    const orphans = orphanBuffer.get(event.sessionID) ?? [];
    orphans.push(event);
    orphanBuffer.set(event.sessionID, orphans);
    
    // Schedule retry
    if (!orphanRetries.has(event.sessionID)) {
      const timeoutId = setTimeout(() => retryCorrelation(event.sessionID), ORPHAN_RETRY_TIMEOUT);
      orphanRetries.set(event.sessionID, timeoutId);
    }
    return;
  }
  
  // Correlação bem-sucedida
  const record = parser.parse(event, routing);
  record.tierAccuracy = aggregator.calculateTierAccuracy(record.totalTokensUsed, routing.tier, cfg);
  
  const sessionState = sessions.get(event.sessionID) ?? { records: [], lastAccessTime: clock.now() };
  sessionState.records.push(record);
  sessionState.lastAccessTime = clock.now();
  sessions.set(event.sessionID, sessionState);
}

function retryCorrelation(sessionId: string): void {
  const routing = routingDecisions.get(sessionId);
  const orphans = orphanBuffer.get(sessionId);
  
  if (routing && orphans) {
    // Retry bem-sucedido
    orphans.forEach(e => {
      const record = parser.parse(e, routing);
      record.tierAccuracy = aggregator.calculateTierAccuracy(record.totalTokensUsed, routing.tier, cfg);
      // Add to session
    });
    orphanBuffer.delete(sessionId);
    orphanRetries.delete(sessionId);
  } else if (orphans) {
    // Timeout → mark as unknown
    orphans.forEach(e => {
      const record = parser.parse(e, undefined);
      record.delegatedTier = 'unknown';
      // Add to session
    });
    orphanBuffer.delete(sessionId);
  }
  
  orphanRetries.delete(sessionId);
}
```

**Benefício:** Eventos correlacionados mesmo em caso de race condition

---

### ✅ ERRO-003 (Hardcoded Thresholds): Config-Driven

**Novo campo em `tiers.json`:**
```json
{
  "tiers": {
    "fast": {
      "model": "github-copilot/claude-haiku-4.5",
      "costRatio": 1,
      "cap": 8,
      "thresholds": { "min": 0, "max": 2000 }
    },
    "medium": {
      "model": "github-copilot/gpt-5.3-codex",
      "costRatio": 5,
      "cap": 12,
      "thresholds": { "min": 2001, "max": 10000 }
    },
    "heavy": {
      "model": "github-copilot/claude-sonnet-4.5",
      "costRatio": 20,
      "cap": 20,
      "thresholds": { "min": 10001, "max": null }
    }
  }
}
```

**No código:**
```typescript
const tierCfg = cfg.tiers[tier as TierName];
if (!tierCfg?.thresholds) return 'UNKNOWN';
const { min, max } = tierCfg.thresholds;
```

**Benefício:** Usuários podem ajustar thresholds sem recompilar

---

### ✅ ERRO-004 (Eviction Prematura): LRU + TTL + PersistOnEvict

```typescript
interface SessionState {
  records: TokenRecord[];
  lastAccessTime: number; // ✅ Track activity
  startTime: number;
}

function evictInactiveSessions(): void {
  const now = clock.now();
  
  for (const [sessionId, state] of sessions.entries()) {
    if (now - state.lastAccessTime > SESSION_TTL) {
      // ✅ Persist before evict
      const summary = getSummary(sessionId);
      persistTokenMetrics(summary); // async but fire-and-forget
      
      sessions.delete(sessionId);
      routingDecisions.delete(sessionId);
      orphanBuffer.delete(sessionId);
      
      const timeout = orphanRetries.get(sessionId);
      if (timeout) {
        clearTimeout(timeout);
        orphanRetries.delete(sessionId);
      }
    }
  }
  
  // Also check if >maxSessions
  if (sessions.size > MAX_IN_MEMORY_SESSIONS) {
    // LRU: evict least recently used
    const lru = [...sessions.entries()]
      .sort(([, a], [, b]) => a.lastAccessTime - b.lastAccessTime)[0];
    
    if (lru) {
      const [sessionId, state] = lru;
      const summary = getSummary(sessionId);
      persistTokenMetrics(summary); // persist before evict
      
      sessions.delete(sessionId);
      routingDecisions.delete(sessionId);
      orphanBuffer.delete(sessionId);
    }
  }
}

// Schedule periodic eviction cleanup
setInterval(() => evictInactiveSessions(), 60000); // every minute
```

**Benefício:** Zero data loss, sessions auto-persisted before eviction

---

### ✅ ERRO-005 (Cleanup Files): MaxHistoryFiles + Auto-Delete

**Novo campo em `tiers.json`:**
```json
{
  "tokenTracking": {
    "maxHistoryFiles": 50,
    "maxHistoryDays": null
  }
}
```

**Na persistência:**
```typescript
async function persistTokenMetrics(summary: SessionTokenSummary): Promise<void> {
  const projectDir = process.cwd();
  const logsDir = join(projectDir, '.opencode', 'router-logs');
  await mkdir(logsDir, { recursive: true });

  // Write new file
  const filename = join(logsDir, `tokens-${summary.sessionId}-${Math.floor(clock.now() / 1000)}.json`);
  const persisted: PersistedTokenSession = {
    version: '1.0', // ✅ SUGESTÃO-005: Versionamento
    sessionId: summary.sessionId,
    startTime: summary.startTime,
    endTime: summary.endTime,
    delegationCount: summary.records.length,
    records: summary.records,
    summary: { ...summary, records: undefined as any },
  };
  
  await storage.save(filename, JSON.stringify(persisted, null, 2));

  // ✅ Cleanup old files
  await cleanupOldFiles(logsDir, cfg.tokenTracking?.maxHistoryFiles ?? 50);
}

async function cleanupOldFiles(dir: string, maxFiles: number): Promise<void> {
  try {
    const files = await storage.listFiles(dir);
    const tokenFiles = files
      .filter(f => f.startsWith('tokens-') && f.endsWith('.json'))
      .sort()
      .reverse(); // newest first

    const toDelete = tokenFiles.slice(maxFiles);
    for (const file of toDelete) {
      await storage.delete(join(dir, file));
    }
  } catch (err) {
    console.warn('[token-tracker] cleanup failed:', err);
  }
}
```

**Benefício:** Disk bounded, performance mantida

---

## Hook Integration (`src/index.ts`) — Atualizado

```typescript
import { createTokenTracker } from './router/token-tracker.js';
import { FilesystemStorage } from './router/filesystem-storage.js';
import { MarkdownMetricsFormatter } from './router/metrics-formatter.js';

const tierRouterPlugin: Plugin = async (ctx) => {
  const capTracker = createCapTracker();
  const cfg = await loadConfig(ctx.directory);
  
  // ✅ Injected dependencies
  const storage = new FilesystemStorage();
  const tokenTracker = createTokenTracker(cfg, storage);
  const formatter = new MarkdownMetricsFormatter();

  return {
    event: async (input) => {
      if (input.event?.type === 'step-finish') {
        const stepEvent = input.event;
        const tier = subagentSessions.has(stepEvent.sessionID)
          ? hardBlockedSessions.get(stepEvent.sessionID) ?? 'unknown'
          : 'unknown';
        
        tokenTracker.recordStepFinish(stepEvent);
      }
    },

    'chat.message': async (input, output) => {
      // ... existing routing logic ...
      
      if (desiredTier) {
        // ✅ Record routing decision for later correlation
        tokenTracker.recordRoutingDecision(input.sessionID, desiredTier, {
          input: Math.ceil(text.length / 4),
          output: 800,
        });
        
        preferredTierSessions.set(input.sessionID, desiredTier);
        selectionSourceSessions.set(input.sessionID, selection.source);
      }
    },

    'command.execute.before': async (input, output) => {
      // ... existing commands ...
      
      if (command === 'token-report') {
        const sessionId = input.sessionID ?? 'unknown';
        const summary = tokenTracker.getSummary(sessionId);
        const report = formatter.formatReport(summary);
        output.parts = [makeTextPart(input.sessionID, report)];
        return;
      }

      if (command === 'token-history') {
        const sessions = await tokenTracker.loadPersistedTokenMetrics();
        const history = formatter.formatHistory(sessions);
        output.parts = [makeTextPart(input.sessionID, history)];
        return;
      }

      if (command === 'token-compare') {
        const tier = (args.split(/\s+/)[0] ?? 'medium') as TierName;
        const sessionId = input.sessionID ?? 'unknown';
        const summary = tokenTracker.getSummary(sessionId);
        const comparison = formatter.formatComparison(summary, tier);
        output.parts = [makeTextPart(input.sessionID, comparison)];
        return;
      }
    },
  };
};
```

---

## Testing Strategy (Com DIP)

```typescript
// ✅ Testes sem I/O real

describe('TokenTracker', () => {
  let tracker: TokenTrackerAPI;
  let storage: InMemoryStorage; // Mock
  let parser: TokenEventParser;
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    storage = new InMemoryStorage();
    parser = new DefaultTokenEventParser();
    aggregator = new DefaultMetricsAggregator();
    tracker = createTokenTracker(cfg, storage, parser, aggregator);
  });

  it('should correlate routing decision with event', async () => {
    tracker.recordRoutingDecision('session-1', 'fast', { input: 100, output: 800 });
    tracker.recordStepFinish({
      type: 'step-finish',
      sessionID: 'session-1',
      cost: 0.001,
      tokens: { input: 150, output: 750, reasoning: 0, cache: { read: 0, write: 0 } },
    });

    const summary = tracker.getSummary('session-1');
    expect(summary.records[0].delegatedTier).toBe('fast');
    expect(summary.records[0].estimatedTokens).toEqual({ input: 100, output: 800 });
  });

  it('should buffer orphan events and retry correlation', async () => {
    // Event arrives BEFORE routing decision
    tracker.recordStepFinish({
      type: 'step-finish',
      sessionID: 'session-1',
      cost: 0.001,
      tokens: { input: 150, output: 750, reasoning: 0, cache: { read: 0, write: 0 } },
    });

    let summary = tracker.getSummary('session-1');
    expect(summary.records[0].delegatedTier).toBe('unknown'); // Buffered

    // Routing decision arrives after 2s
    await new Promise(resolve => setTimeout(resolve, 2000));
    tracker.recordRoutingDecision('session-1', 'fast', { input: 100, output: 800 });

    // Wait for retry (5s total)
    await new Promise(resolve => setTimeout(resolve, 3100));
    
    summary = tracker.getSummary('session-1');
    expect(summary.records[0].delegatedTier).toBe('fast'); // Correlated!
  });

  it('should persist before evicting inactive session', async () => {
    tracker.recordStepFinish({...});
    
    // Simulate 30+ minutes of inactivity
    // Eviction cleanup runs → persists automatically
    
    const files = await storage.listFiles('.opencode/router-logs');
    expect(files.length).toBeGreaterThan(0);
  });
});
```

---

## Configuration Schema Update

`tiers.json` agora deve incluir:

```json
{
  "mode": "normal",
  "tiers": {
    "fast": {
      "model": "github-copilot/claude-haiku-4.5",
      "costRatio": 1,
      "cap": 8,
      "thresholds": { "min": 0, "max": 2000 }
    },
    "medium": {
      "model": "github-copilot/gpt-5.3-codex",
      "costRatio": 5,
      "cap": 12,
      "thresholds": { "min": 2001, "max": 10000 }
    },
    "heavy": {
      "model": "github-copilot/claude-sonnet-4.5",
      "costRatio": 20,
      "cap": 20,
      "thresholds": { "min": 10001, "max": null }
    }
  },
  "tokenTracking": {
    "maxHistoryFiles": 50,
    "maxHistoryDays": null
  }
}
```

---

## Performance & Memory

- **Event recording:** O(1), <0.1ms per event
- **Summary calculation:** O(n) where n = records, <10ms for 1000 records
- **Persistence:** Async, non-blocking, cleanup bounded to 50 files max
- **Memory:** Bounded at 100 sessions × ~50KB = 5MB max, auto-evicted after 30min inactivity
- **Cleanup:** O(n) files scan but only on persist, lazy

---

## Error Handling

| Case | Handling |
|------|----------|
| sessionId missing | Use 'unknown', warn in logs |
| Event orphan (no routing) | Buffer 5s, retry, mark as unknown if timeout |
| Routing decision orphan | Swept every minute, cleaned up |
| Logs dir doesn't exist | Created on first persist |
| Malformed JSON | Skipped, warning logged |
| Eviction needed | Persist to storage before delete |
| Storage error | Log warning, continue (best-effort) |

---

## Versionamento de Dados

**Persisted Session Schema (v1.0):**
```json
{
  "version": "1.0",
  "sessionId": "abc123",
  "startTime": 1234567890000,
  "endTime": 1234567900000,
  "delegationCount": 5,
  "records": [...],
  "summary": {...}
}
```

Compatibilidade futura: se schema mudar para v2.0, código pode fazer upgrade sem quebrar.
