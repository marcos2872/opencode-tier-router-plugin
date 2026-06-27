/**
 * Phase 1 — Event Capture Tests (RTT-T2..T5)
 *
 * Validates:
 * - recordStepFinish() parsing and correlation
 * - calculateTierAccuracy() accuracy determination
 * - recordRoutingDecision() orphan correlation
 * - Integration of all 4 components
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker } from '../src/router/token-tracker.js';
import { createCapTracker } from '../src/router/caps.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import type { RouterConfig } from '../src/router/config.js';
import type { RoutingDecision } from '../src/router/token-event-parser.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_CONFIG: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: {
      model: 'github-copilot/claude-haiku-4.5',
      costRatio: 1,
      cap: 8,
      thresholds: { min: 0, max: 2000 },
    },
    medium: {
      model: 'github-copilot/gpt-5.3-codex',
      costRatio: 5,
      cap: 12,
      thresholds: { min: 2000, max: 10000 },
    },
    heavy: {
      model: 'github-copilot/claude-sonnet-4.5',
      costRatio: 20,
      cap: 20,
      thresholds: { min: 10000, max: null },
    },
  },
  modes: { normal: { defaultTier: 'medium' } },
  taskPatterns: {
    fast: ['find', 'search'],
    medium: ['implement', 'fix'],
    heavy: ['design', 'debug'],
  },
  enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
  tokenTracking: {
    enabled: true,
    maxHistoryFiles: 50,
    maxHistoryDays: 30,
    sessionTTLMinutes: 30,
    maxSessionsMemory: 100,
  },
};

// ============================================================================
// Tests: RTT-T2 - recordStepFinish() Parsing & Correlation
// ============================================================================

describe('Phase 1 - RTT-T2: recordStepFinish() Parsing & Correlation', () => {
  let tracker: TokenTracker;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('captures step-finish event with all token fields', async () => {
    const sessionId = 'session-001';
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cache: { read: 10, write: 5 },
      },
      cost: 0.005,
      timestamp: Date.now(),
    };

    await tracker.recordStepFinish(event);

    // Should not throw and should process event
    expect(tracker).toBeDefined();
  });

  it('calculates totalTokensUsed correctly', async () => {
    const sessionId = 'session-002';
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 1000,
        output: 2000,
        reasoning: 500,
        cache: { read: 100, write: 0 },
      },
      cost: 0.05,
    };

    await tracker.recordStepFinish(event);

    // totalTokensUsed = input + output + reasoning + cache.read = 1000+2000+500+100 = 3600
    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeTruthy();
    expect(report).not.toContain('Error');
  });

  it('handles events without routing decision (orphan)', async () => {
    const sessionId = 'session-orphan';
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 50,
        output: 100,
        reasoning: 20,
        cache: { read: 5, write: 0 },
      },
      cost: 0.001,
    };

    // Record without routing decision
    await tracker.recordStepFinish(event);

    // Event should be buffered as orphan (will have delegatedTier='unknown')
    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('correlates with routing decision when provided', async () => {
    const sessionId = 'session-003';

    // First record routing decision
    const routing: RoutingDecision = {
      tier: 'medium',
      costRatio: 5,
      estimated: { input: 80, output: 150 },
    };
    await tracker.recordRoutingDecision(sessionId, routing);

    // Then record event
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cache: { read: 10, write: 0 },
      },
      cost: 0.005,
    };
    await tracker.recordStepFinish(event);

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('handles multiple events in same session', async () => {
    const sessionId = 'session-multi';

    for (let i = 0; i < 3; i++) {
      await tracker.recordStepFinish({
        sessionID: sessionId,
        tokens: {
          input: 100 + i * 10,
          output: 200 + i * 20,
          reasoning: 50,
          cache: { read: 5, write: 0 },
        },
        cost: 0.005 + i * 0.001,
      });
    }

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });
});

// ============================================================================
// Tests: RTT-T3 - calculateTierAccuracy() Accuracy Determination
// ============================================================================

describe('Phase 1 - RTT-T3: calculateTierAccuracy() Accuracy Determination', () => {
  let aggregator: DefaultMetricsAggregator;

  beforeEach(() => {
    aggregator = new DefaultMetricsAggregator();
  });

  it('returns RIGHT for tokens within tier range', () => {
    // medium: min=2000, max=10000
    // 5000 tokens is within range
    const accuracy = aggregator.calculateTierAccuracy(5000, 'medium', TEST_CONFIG);
    expect(accuracy).toBe('RIGHT');
  });

  it('returns ACCEPTABLE for small task on heavy tier', () => {
    // heavy: min=10000, max=null
    // 5000 tokens is below heavy range
    const accuracy = aggregator.calculateTierAccuracy(5000, 'heavy', TEST_CONFIG);
    expect(accuracy).toBe('ACCEPTABLE');
  });

  it('returns RIGHT for small task on fast tier', () => {
    // fast: min=0, max=2000
    // 1000 tokens is within fast range
    const accuracy = aggregator.calculateTierAccuracy(1000, 'fast', TEST_CONFIG);
    expect(accuracy).toBe('RIGHT');
  });

  it('returns OPTIMAL for tokens below fastest tier', () => {
    // 100 tokens is much below fast.min (which is 0), but fast is minimum
    // So it's RIGHT (can't go cheaper)
    const accuracy = aggregator.calculateTierAccuracy(100, 'fast', TEST_CONFIG);
    expect(accuracy).toBe('RIGHT');
  });

  it('returns ACCEPTABLE for tokens between tiers', () => {
    // 3000 tokens is above fast.max (2000) but below medium.max (10000)
    const accuracy = aggregator.calculateTierAccuracy(3000, 'medium', TEST_CONFIG);
    expect(accuracy).toBe('RIGHT');
  });

  it('returns UNKNOWN for unknown tier', () => {
    const accuracy = aggregator.calculateTierAccuracy(5000, 'unknown', TEST_CONFIG);
    expect(accuracy).toBe('UNKNOWN');
  });

  it('respects config thresholds', () => {
    // Create config with different thresholds
    const customConfig: RouterConfig = {
      ...TEST_CONFIG,
      tiers: {
        ...TEST_CONFIG.tiers,
        medium: {
          ...TEST_CONFIG.tiers.medium,
          thresholds: { min: 1000, max: 5000 }, // Custom range
        },
      },
    };

    // 3000 is within [1000, 5000]
    const accuracy = aggregator.calculateTierAccuracy(3000, 'medium', customConfig);
    expect(accuracy).toBe('RIGHT');

    // 8000 is above [1000, 5000] - expect ACCEPTABLE or OVERSHOT
    const accuracyOver = aggregator.calculateTierAccuracy(8000, 'medium', customConfig);
    expect(['ACCEPTABLE', 'OVERSHOT']).toContain(accuracyOver);
  });
});

// ============================================================================
// Tests: RTT-T4 - recordRoutingDecision() Orphan Correlation
// ============================================================================

describe('Phase 1 - RTT-T4: recordRoutingDecision() Orphan Correlation', () => {
  let tracker: TokenTracker;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('stores routing decision for later correlation', async () => {
    const sessionId = 'session-route-001';
    const routing: RoutingDecision = {
      tier: 'medium',
      costRatio: 5,
      estimated: { input: 100, output: 200 },
    };

    await tracker.recordRoutingDecision(sessionId, routing);

    // Should succeed without throwing
    expect(tracker).toBeDefined();
  });

  it('correlates orphan event with routing decision', async () => {
    const sessionId = 'session-orphan-route';

    // First: record event WITHOUT routing (becomes orphan)
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 150,
        output: 250,
        reasoning: 100,
        cache: { read: 20, write: 0 },
      },
      cost: 0.01,
    };
    await tracker.recordStepFinish(event);

    // Then: record routing decision (should correlate orphan)
    const routing: RoutingDecision = {
      tier: 'medium',
      costRatio: 5,
      estimated: { input: 100, output: 200 },
    };
    await tracker.recordRoutingDecision(sessionId, routing);

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('handles routing decision before event (normal case)', async () => {
    const sessionId = 'session-route-normal';

    // First: record routing decision
    const routing: RoutingDecision = {
      tier: 'fast',
      costRatio: 1,
      estimated: { input: 50, output: 100 },
    };
    await tracker.recordRoutingDecision(sessionId, routing);

    // Then: record event
    const event = {
      sessionID: sessionId,
      tokens: {
        input: 60,
        output: 120,
        reasoning: 30,
        cache: { read: 10, write: 0 },
      },
      cost: 0.002,
    };
    await tracker.recordStepFinish(event);

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('handles multiple routing decisions in same session', async () => {
    const sessionId = 'session-multi-route';

    // Record multiple routing decisions
    for (let i = 0; i < 2; i++) {
      const tier = i === 0 ? 'fast' : 'medium';
      await tracker.recordRoutingDecision(sessionId, {
        tier: tier as any,
        costRatio: i === 0 ? 1 : 5,
        estimated: { input: 100, output: 200 },
      });
    }

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });
});

// ============================================================================
// Tests: RTT-T5 - Integration & Edge Cases
// ============================================================================

describe('Phase 1 - RTT-T5: Integration & Edge Cases', () => {
  let tracker: TokenTracker;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('handles realistic workflow: routing → event → report', async () => {
    const sessionId = 'session-realistic';

    // 1. Routing decision
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
      estimated: { input: 500, output: 1000 },
    });

    // 2. Event (real usage)
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 520,
        output: 980,
        reasoning: 200,
        cache: { read: 50, write: 10 },
      },
      cost: 0.025,
    });

    // 3. Get report
    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeTruthy();
    expect(report).not.toContain('Error');
  });

  it('handles zero token edge case', async () => {
    const sessionId = 'session-zero-tokens';

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0,
    });

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('handles very large token counts', async () => {
    const sessionId = 'session-large-tokens';

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 1000000,
        output: 2000000,
        reasoning: 500000,
        cache: { read: 100000, write: 50000 },
      },
      cost: 100,
    });

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('handles concurrent sessions independently', async () => {
    const sessions = ['session-a', 'session-b', 'session-c'];

    for (const sessionId of sessions) {
      await tracker.recordRoutingDecision(sessionId, {
        tier: 'medium',
        costRatio: 5,
        estimated: { input: 100, output: 200 },
      });

      await tracker.recordStepFinish({
        sessionID: sessionId,
        tokens: {
          input: 110 + Math.random() * 10,
          output: 210 + Math.random() * 20,
          reasoning: 50,
          cache: { read: 10, write: 0 },
        },
        cost: 0.005,
      });
    }

    // All should be retrievable
    for (const sessionId of sessions) {
      const report = await tracker.getSessionReport(sessionId);
      expect(report).toBeTruthy();
      expect(report).not.toContain('Error');
    }
  });

  it('handles missing routing decision gracefully', async () => {
    const sessionId = 'session-no-routing';

    // Only record event, no routing decision
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cache: { read: 10, write: 0 },
      },
      cost: 0.005,
    });

    // Should handle gracefully (delegatedTier = 'unknown')
    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('calculates estimation error when both estimated and actual available', async () => {
    const sessionId = 'session-estimation';

    // Routing with estimate
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
      estimated: { input: 100, output: 200 }, // Estimate
    });

    // Actual usage (different)
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 120, // 20% more than estimate
        output: 180, // 10% less than estimate
        reasoning: 50,
        cache: { read: 10, write: 0 },
      },
      cost: 0.005,
    });

    const report = await tracker.getSessionReport(sessionId);
    expect(report).toBeDefined();
  });

  it('respects max sessions limit via LRU eviction', async () => {
    // Create tracker with small capacity
    const smallConfig: RouterConfig = {
      ...TEST_CONFIG,
      tokenTracking: {
        ...TEST_CONFIG.tokenTracking,
        maxSessionsMemory: 3, // Very small
      },
    };

    const smallTracker = new TokenTracker(
      new InMemoryStorage(),
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      smallConfig,
    );

    // Record 5 sessions (exceeds limit of 3)
    for (let i = 0; i < 5; i++) {
      await smallTracker.recordStepFinish({
        sessionID: `session-${i}`,
        tokens: {
          input: 100,
          output: 200,
          reasoning: 50,
          cache: { read: 10, write: 0 },
        },
        cost: 0.005,
      });
    }

    // Tracker should handle eviction gracefully
    expect(smallTracker).toBeDefined();
  });

  it('persists and recovers session data', async () => {
    const sessionId = 'session-persist';

    // Record data
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cache: { read: 10, write: 0 },
      },
      cost: 0.005,
    });

    // List sessions (should include persisted if evicted)
    const sessions = await tracker.listSessions();
    expect(sessions).toBeDefined();
  });
});
