# Real Token Cost Tracking — Feature Specification

**Feature ID:** RTT-001  
**Status:** Specified  
**Complexity:** Large (4 phases, ~12-14 atomic tasks, 25-30 files modified)  
**Last Updated:** 2026-06-27  
**Category:** Observability / Analytics

---

## Overview

Extend the **opencode-tier-router** plugin to track and report **real token consumption** from model responses. Enable users to see actual cost and accuracy of router decisions by comparing delegated tier vs observed token usage.

**Why:** The router works correctly (85 tests ✅), but has no visibility into whether delegations actually saved tokens. This feature captures real usage data (input/output tokens, cost, reasoning tokens) from OpenCode events and enables cost-benefit analysis.

**Scope:**
1. Capture `step-finish` events with real token/cost data
2. Correlate token data with routing decisions (which tier was used)
3. Calculate accuracy metrics: "was this task routed to the right tier?"
4. Persist full metrics to `.opencode/router-logs/` for analysis
5. Expose `/token-report` and `/token-history` commands
6. Support aggregation: show savings, estimation errors, tier accuracy

---

## Acceptance Criteria

### P1: Event Capture & Token Parsing (RTT-A1..A4)

#### RTT-A1: Capture step-finish events with real token data

**WHEN** OpenCode emits a `step-finish` event (after model response)  
**THEN** plugin SHALL:
1. Extract sessionId from event
2. Extract tier (from subagent sessions map or fallback to model)
3. Extract token data: input, output, reasoning, cache.read, cache.write
4. Extract cost (real cost from event)
5. Store correlation: sessionId → tier → tokens → cost

**Event Structure (from OpenCode SDK):**
```typescript
{
  type: "step-finish";
  sessionID: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}
```

**File:** `src/router/token-tracker.ts` → `createTokenTracker().recordStepFinish()`  
**Test:** Mock event, verify all fields captured

---

#### RTT-A2: Correlate tokens with routing tier

**WHEN** a `step-finish` event is captured  
**AND** the sessionId has a preferred tier stored (from routing decision)  
**THEN** the token record SHALL include:
- `delegatedTier` ('fast' | 'medium' | 'heavy' | 'unknown')
- `modelUsed` (from event or inferred from tier)
- `estimatedInputTokens` (from routing decision, if available)
- `estimatedOutputTokens` (from routing decision, if available)

**File:** `src/router/token-tracker.ts`  
**Test:** Record routing decision, capture event, verify correlation

---

#### RTT-A3: Calculate estimation error

**WHEN** token tracking has both estimated (from routing) and actual (from event):  
**THEN** calculate:
- `estimationErrorInput` = (actualInput - estimatedInput) / estimatedInput % 
- `estimationErrorOutput` = (actualOutput - estimatedOutput) / estimatedOutput %
- `totalTokensUsed` = input + output + reasoning + cache.read
- `accuracyScore` = how well was tier chosen? (see RTT-A4)

**File:** `src/router/token-tracker.ts` → `calculateAccuracy()`  
**Test:** Mock data, verify error calculation

---

#### RTT-A4: Determine tier accuracy (was tier choice correct?)

**WHEN** session has real token data  
**THEN** assign accuracy tier:
- ✅ **OPTIMAL**: tokens ≤ cheapest tier threshold → could have used cheaper tier
- ✅ **RIGHT**: tokens match delegated tier range → correct choice
- ✅ **ACCEPTABLE**: tokens between two tiers → acceptable choice
- ⚠️ **SUBOPTIMAL**: tokens far below delegated tier → could save by downgrading
- ❌ **OVERSHOT**: tokens exceed delegated tier → should have upgraded

**Heuristic Thresholds (from config or defaults):**
```
@fast (1x):      ≤ 2000 total tokens
@medium (5x):    2001-10000 total tokens
@heavy (20x):    >10000 total tokens
```

**File:** `src/router/token-tracker.ts` → `calculateTierAccuracy()`  
**Test:** Mock tokens in each range, verify accuracy assignment

---

### P2: Metrics Aggregation & Storage (RTT-A5..A7)

#### RTT-A5: Calculate session summary with accuracy metrics

**WHEN** `getSummary(sessionId)` is called  
**THEN** return:
```typescript
{
  sessionId: string;
  delegations: TokenRecord[];
  
  // Real token data
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCostReal: number; // actual cost from events
  
  // Accuracy metrics
  accuracyBreakdown: {
    optimal: number;      // % of sessions that could use cheaper tier
    right: number;        // % of sessions routed correctly
    acceptable: number;   // % of sessions within acceptable range
    suboptimal: number;   // % routed too expensively
    overshot: number;     // % exceeding tier capacity
  };
  
  // Estimation error
  averageInputEstimationError: number;  // % error
  averageOutputEstimationError: number; // % error
  
  // Comparison to baseline
  costSavedVsDefault: number;    // vs medium (5x) all time
  costSavedVsHeavy: number;      // vs heavy (20x) all time
  averageActualCostRatio: number;
}
```

**File:** `src/router/token-tracker.ts` → `getSummary()`  
**Test:** Aggregate 10+ mock records, verify all calculations

---

#### RTT-A6: Persist full token metrics to `.opencode/router-logs/`

**WHEN** session ends (OR checkpoint every N events)  
**THEN** write to:  
```
.opencode/router-logs/tokens-{sessionId}-{timestamp}.json
```

**Content:**
```json
{
  "sessionId": "abc123",
  "startTime": 1234567890000,
  "endTime": 1234567900000,
  "delegationCount": 5,
  "records": [
    {
      "delegatedTier": "fast",
      "modelUsed": "github-copilot/claude-haiku-4.5",
      "actualTokens": {
        "input": 250,
        "output": 1800,
        "reasoning": 0,
        "cache": { "read": 0, "write": 0 }
      },
      "estimatedTokens": { "input": 300, "output": 800 },
      "realCost": 0.00245,
      "estimatedCost": 0.0011,
      "tierAccuracy": "RIGHT",
      "estimationError": { "input": -16.7, "output": 125 },
      "timestamp": 1234567891000
    },
    ...
  ],
  "summary": {
    "totalTokens": 15000,
    "totalCost": 0.0456,
    "accuracyBreakdown": { ... },
    "costSavedVsDefault": 0.0123
  }
}
```

**File:** `src/router/token-tracker.ts` → `persistTokenMetrics()`  
**Test:** Write to temp, read back, verify structure

---

#### RTT-A7: Load and cache persisted token metrics

**WHEN** plugin starts  
**THEN** scan `.opencode/router-logs/tokens-*.json` and cache summaries  
**AND** support historical queries without full re-parsing

**File:** `src/router/token-tracker.ts` → `loadPersistedTokenMetrics()`  
**Test:** Create sample files, verify loading + caching

---

### P3: Commands & Reporting (RTT-A8..A10)

#### RTT-A8: Implement `/token-report` command

**WHEN** user types `/token-report`  
**THEN** return markdown report:
```
## Real Token Cost Report
**Session:** `abc123`
**Duration:** 2m 34s

### Usage Summary
Total requests: 5
Total tokens: 15,240 (input: 4,250 + output: 10,990)
Total real cost: 0.0456
Average actual tier ratio: 2.1x

### Tier Accuracy
- ✅ Right: 60% (3/5 requests)
- ⚠️ Acceptable: 20% (1/5 requests)
- ❌ Suboptimal: 20% (1/5 requests)

### Estimation Accuracy
- Input estimation error: -12.3% (reasonable)
- Output estimation error: +34% (overestimated)

### Savings Analysis
- Real cost: 0.0456
- Cost if all @heavy (20x): 0.1824
- Savings: 0.1368 (75%)
- Cost if all @medium (5x): 0.0570
- Actual performance: -0.0114 (5% more expensive than default)
```

**File:** `src/index.ts` → hook `command.execute.before`  
**Test:** Mock summary, verify markdown format

---

#### RTT-A9: Implement `/token-history` command

**WHEN** user types `/token-history`  
**THEN** list all persisted sessions:
```
## Token Tracking History
| Session | Duration | Tokens | Cost | Accuracy | Savings |
|---------|----------|--------|------|----------|---------|
| abc123  | 2m 34s   | 15.2K  | 0.0456 | 60% RIGHT | -5% |
| def456  | 5m 12s   | 28.1K  | 0.0892 | 80% RIGHT | +22% |
| ...     | ...      | ...    | ...  | ...      | ...    |
```

**File:** `src/index.ts` → hook `command.execute.before`  
**Test:** Create mock persisted files, verify table

---

#### RTT-A10: Implement `/token-compare <tier>` command (optional, P4)

**WHEN** user types `/token-compare fast` (or medium/heavy)  
**THEN** show hypothetical cost if all requests had gone to that tier:
```
## Tier Comparison Report
Current distribution: @fast=30%, @medium=50%, @heavy=20%
Actual cost: 0.0456

If all routed to @fast:   0.0152 (67% cheaper)
If all routed to @medium: 0.0570 (25% more expensive)
If all routed to @heavy:  0.1824 (300% more expensive)

Recommendation: Current routing is good. @fast alone would lose accuracy.
```

---

### P4: Integration & Validation (RTT-A11..A13)

#### RTT-A11: Wire token tracker into event hook

**WHEN** plugin receives event  
**AND** event.type === 'step-finish'  
**THEN** plugin SHALL:
1. Route event to `tokenTracker.recordStepFinish(event)`
2. Correlate with routing decision (if same sessionId)
3. Store in memory and queue for persistence

**File:** `src/index.ts` → hook `event`  
**Test:** Mock event, verify recorded

---

#### RTT-A12: Integrate with existing routing state

**WHEN** routing decision is made (in `chat.message` hook)  
**THEN** token tracker SHALL:
1. Store correlation: sessionId → tier + estimated tokens
2. Make this available later when token event arrives

**File:** `src/index.ts` → extend `chat.message` hook  
**Test:** Routing → event → verify correlation

---

#### RTT-A13: All tests pass (≥90% coverage on new code)

**WHEN** `npm run typecheck && npx vitest run` is executed  
**THEN** all tests SHALL pass  
**AND** `vitest --coverage src/router/token-tracker.ts` ≥90%

**File:** `test/token-tracker.test.ts` (new)  
**Test:** Jest/vitest coverage report

---

## Implementation Phases

### Phase 1: Event Capture (RTT-A1..A4)
- **Effort:** 8-10 hours
- **Output:** `src/router/token-tracker.ts` with event parsing + accuracy calculation
- **Tests:** 15+ unit tests for parsing, correlation, accuracy

### Phase 2: Persistence & Aggregation (RTT-A5..A7)
- **Effort:** 6-8 hours
- **Output:** Summary calculation + file I/O + caching
- **Tests:** 10+ integration tests

### Phase 3: Commands & Reporting (RTT-A8..A10)
- **Effort:** 6-8 hours
- **Output:** CLI commands + markdown formatters
- **Tests:** 10+ command tests

### Phase 4: Integration (RTT-A11..A13)
- **Effort:** 4-6 hours
- **Output:** Wire into plugin hooks, full end-to-end test
- **Tests:** 20+ integration tests + coverage validation

**Total Estimated Effort:** 24-32 hours (3-4 days)

---

## Data Structures

### TokenRecord
```typescript
interface TokenRecord {
  // Event data (REAL)
  sessionId: string;
  timestamp: number;
  actualTokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  realCost: number;

  // Routing decision (from memory)
  delegatedTier: 'fast' | 'medium' | 'heavy' | 'unknown';
  modelUsed: string;
  estimatedTokens?: {
    input: number;
    output: number;
  };
  estimatedCost?: number;

  // Calculated
  tierAccuracy: 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT';
  estimationError: {
    input: number;  // %
    output: number; // %
  };
  totalTokensUsed: number;
}

interface SessionTokenSummary {
  sessionId: string;
  records: TokenRecord[];
  startTime: number;
  endTime: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCostReal: number;
  accuracyBreakdown: {
    optimal: number;
    right: number;
    acceptable: number;
    suboptimal: number;
    overshot: number;
  };
  costSavedVsDefault: number;
  costSavedVsHeavy: number;
}
```

---

## Provider Support

Parser MUST support multiple providers (auto-detect from model string):

| Provider | Model String | Token Extraction |
|----------|--------------|------------------|
| Anthropic | `anthropic/claude-*` | Event.tokens (via OpenCode SDK) |
| OpenAI | `openai/gpt-4*` | Event.tokens (via OpenCode SDK) |
| GitHub Copilot | `github-copilot/*` | Event.tokens (via OpenCode SDK) |
| Others | Any | Event.tokens (unified OpenCode SDK interface) |

**Note:** All providers return tokens via unified OpenCode SDK `step-finish` event → no per-provider parsing needed.

---

## Non-Goals (Out of Scope)

- Real-time billing integration (metrics only, no API calls to billing services)
- Automatic tier recommendations (data analysis only, no auto-adjustment)
- UI dashboard (CLI reports only)
- Historical trend analysis (persist raw data, analysis optional)
- Cost forecasting (track only, no predictions)

---

## Success Criteria

✅ User can run `/token-report` and see real token usage + accuracy  
✅ User can run `/token-history` and see past sessions  
✅ Tokens are REAL (from events, not estimates)  
✅ Accuracy metrics show tier choice quality  
✅ Estimation error shows router heuristic accuracy  
✅ Savings are quantified from real cost data  
✅ No performance regression  
✅ All new code has tests + ≥90% coverage

---

## Notes

- **Real data:** Uses `step-finish` events, not heuristic estimates
- **Correlation:** Token data linked to routing decision via sessionId + tier from memory
- **Accuracy:** Determines if tier was over/under/correct for actual token consumption
- **Persistence:** Full raw records + summaries for analysis
- **Multi-provider:** OpenCode SDK provides unified interface, no per-provider code needed
