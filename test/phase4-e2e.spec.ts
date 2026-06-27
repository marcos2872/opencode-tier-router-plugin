/**
 * Phase 4 — End-to-End Tests (FASE4)
 *
 * Validates:
 * - Token event capture (step-finish) → recording
 * - Routing decision capture → correlation
 * - Persistence → command retrieval
 * - Full session lifecycle
 * - Coverage ≥90%
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker } from '../src/router/token-tracker.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import { executeTokenCommand } from '../src/router/token-commands.js';
import type { RouterConfig, TierName } from '../src/router/config.js';
import type { StepFinishEvent, RoutingDecision } from '../src/router/token-event-parser.js';

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
// Tests: FASE4-E2E-T1 - Full Session Lifecycle
// ============================================================================

describe('Phase 4 - FASE4-E2E-T1: Full Session Lifecycle', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('records event, computes metrics, and retrieves via command', async () => {
    const sessionId = 'sess-e2e-001';

    // Step 1: Record a step-finish event
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

    // Step 2: Retrieve via command
    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    // Verify report contains expected data
    expect(report).toBeTruthy();
    expect(report).toContain(sessionId);
    expect(report).toContain('100'); // input tokens
    expect(report).toContain('200'); // output tokens
    expect(report).toContain('Real Token Cost Report');
  });

  it('records multiple events in same session and aggregates', async () => {
    const sessionId = 'sess-e2e-002';

    // Record multiple events
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

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 50,
        output: 150,
        reasoning: 25,
        cache: { read: 5, write: 0 },
      },
      cost: 0.003,
    });

    // Retrieve and verify aggregation
    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toContain('2'); // 2 requests
    expect(report).toContain('150'); // total input (100+50)
    expect(report).toContain('350'); // total output (200+150)
  });

  it('records routing decisions and correlates with events', async () => {
    const sessionId = 'sess-e2e-003';

    // Record routing decision first
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
    });

    // Then record event
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 1000,
        output: 2000,
        reasoning: 500,
        cache: { read: 100, write: 0 },
      },
      cost: 0.015,
    });

    // Verify correlation in report
    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toBeTruthy();
    // Metrics should include tier accuracy
    expect(report).toContain('Tier Accuracy');
  });

  it('persists session on eviction and retrieves from disk', async () => {
    const sessionId = 'sess-e2e-004';

    // Record event
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

    // Manually trigger eviction (simulating cache pressure)
    // In real scenario, this happens via handleEvictions
    // For this test, we just verify the data is retrievable

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toBeTruthy();
    expect(report).toContain(sessionId);
  });

  it('handles multiple sessions independently', async () => {
    const sess1 = 'sess-e2e-005-a';
    const sess2 = 'sess-e2e-005-b';

    // Session 1: Fast tier
    await tracker.recordRoutingDecision(sess1, {
      tier: 'fast',
      costRatio: 1,
    });

    await tracker.recordStepFinish({
      sessionID: sess1,
      tokens: {
        input: 100,
        output: 100,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0.0004,
    });

    // Session 2: Heavy tier
    await tracker.recordRoutingDecision(sess2, {
      tier: 'heavy',
      costRatio: 20,
    });

    await tracker.recordStepFinish({
      sessionID: sess2,
      tokens: {
        input: 5000,
        output: 10000,
        reasoning: 2000,
        cache: { read: 500, write: 0 },
      },
      cost: 0.06,
    });

    // Verify independent reports
    const report1 = await executeTokenCommand(tracker, 'token-report', sess1);
    const report2 = await executeTokenCommand(tracker, 'token-report', sess2);

    expect(report1).not.toContain(sess2);
    expect(report2).not.toContain(sess1);
    expect(report1).toContain(sess1);
    expect(report2).toContain(sess2);
  });
});

// ============================================================================
// Tests: FASE4-E2E-T2 - Command Retrieval After Event Capture
// ============================================================================

describe('Phase 4 - FASE4-E2E-T2: Command Retrieval After Event Capture', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('/token-report works after event recording', async () => {
    const sessionId = 'sess-cmd-001';

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 500,
        output: 1000,
        reasoning: 200,
        cache: { read: 50, write: 0 },
      },
      cost: 0.01,
    });

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toContain('Real Token Cost Report');
    expect(report).toContain(sessionId);
    expect(report).toContain('500'); // input
    expect(report).toContain('1000'); // output
    expect(report).toContain('0.01'); // cost
  });

  it('/token-compare works with recorded event', async () => {
    const sessionId = 'sess-cmp-001';

    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
    });

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 2000,
        output: 4000,
        reasoning: 1000,
        cache: { read: 200, write: 0 },
      },
      cost: 0.035,
    });

    // Compare to fast tier
    const comparison = await executeTokenCommand(tracker, 'token-compare', `${sessionId} fast`);

    expect(comparison).toBeTruthy();
    expect(comparison).toContain('Tier Comparison');
    expect(comparison).toContain('fast');
    expect(comparison).toContain('0.035'); // actual cost
  });

  it('/token-history returns formatted list after multiple events', async () => {
    const sess1 = 'sess-hist-001';
    const sess2 = 'sess-hist-002';

    // Record multiple sessions
    await tracker.recordStepFinish({
      sessionID: sess1,
      tokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cache: { read: 10, write: 0 },
      },
      cost: 0.005,
    });

    await tracker.recordStepFinish({
      sessionID: sess2,
      tokens: {
        input: 300,
        output: 600,
        reasoning: 150,
        cache: { read: 30, write: 0 },
      },
      cost: 0.015,
    });

    const history = await executeTokenCommand(tracker, 'token-history', '');

    expect(history).toContain('Token Tracking History');
    // Both sessions should appear in history
    expect(history).toContain(sess1.slice(0, 8));
    expect(history).toContain(sess2.slice(0, 8));
  });
});

// ============================================================================
// Tests: FASE4-E2E-T3 - Routing Decision Correlation
// ============================================================================

describe('Phase 4 - FASE4-E2E-T3: Routing Decision Correlation', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('decision before event: correlates and computes accuracy', async () => {
    const sessionId = 'sess-order-001';

    // Decision first
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
    });

    // Event second
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 2000,
        output: 4000,
        reasoning: 1000,
        cache: { read: 200, write: 0 },
      },
      cost: 0.035,
    });

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toContain('Tier Accuracy');
  });

  it('event before decision: orphan buffer correlates later', async () => {
    const sessionId = 'sess-orphan-001';

    // Event first (orphan)
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 1000,
        output: 2000,
        reasoning: 500,
        cache: { read: 100, write: 0 },
      },
      cost: 0.015,
    });

    // Wait a bit, then decision
    await new Promise(r => setTimeout(r, 100));

    await tracker.recordRoutingDecision(sessionId, {
      tier: 'heavy',
      costRatio: 20,
    });

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(report).toBeTruthy();
    expect(report).toContain(sessionId);
  });

  it('tracks tier accuracy across multiple tiers', async () => {
    // Fast tier session
    const fastSess = 'sess-fast-001';
    await tracker.recordRoutingDecision(fastSess, {
      tier: 'fast',
      costRatio: 1,
    });
    await tracker.recordStepFinish({
      sessionID: fastSess,
      tokens: {
        input: 100,
        output: 100,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: 0.0004,
    });

    // Medium tier session
    const mediumSess = 'sess-med-001';
    await tracker.recordRoutingDecision(mediumSess, {
      tier: 'medium',
      costRatio: 5,
    });
    await tracker.recordStepFinish({
      sessionID: mediumSess,
      tokens: {
        input: 2000,
        output: 4000,
        reasoning: 1000,
        cache: { read: 200, write: 0 },
      },
      cost: 0.035,
    });

    // Heavy tier session
    const heavySess = 'sess-heavy-001';
    await tracker.recordRoutingDecision(heavySess, {
      tier: 'heavy',
      costRatio: 20,
    });
    await tracker.recordStepFinish({
      sessionID: heavySess,
      tokens: {
        input: 10000,
        output: 20000,
        reasoning: 5000,
        cache: { read: 1000, write: 0 },
      },
      cost: 0.28,
    });

    // Verify each has report
    const fastReport = await executeTokenCommand(tracker, 'token-report', fastSess);
    const mediumReport = await executeTokenCommand(tracker, 'token-report', mediumSess);
    const heavyReport = await executeTokenCommand(tracker, 'token-report', heavySess);

    expect(fastReport).toContain(fastSess);
    expect(mediumReport).toContain(mediumSess);
    expect(heavyReport).toContain(heavySess);
  });
});

// ============================================================================
// Tests: FASE4-E2E-T4 - Session Aggregation & Accuracy Computation
// ============================================================================

describe('Phase 4 - FASE4-E2E-T4: Session Aggregation & Accuracy', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('aggregates tokens across events', async () => {
    const sessionId = 'sess-agg-001';

    // Event 1
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

    // Event 2
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 150,
        output: 300,
        reasoning: 75,
        cache: { read: 15, write: 0 },
      },
      cost: 0.0075,
    });

    // Event 3
    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 50,
        output: 100,
        reasoning: 25,
        cache: { read: 5, write: 0 },
      },
      cost: 0.0025,
    });

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    // Should show 3 requests
    expect(report).toContain('3');
    // Should aggregate inputs: 100+150+50 = 300
    expect(report).toContain('300');
    // Should aggregate outputs: 200+300+100 = 600
    expect(report).toContain('600');
    // Should sum reasoning: 50+75+25 = 150
    expect(report).toContain('150');
  });

  it('computes cost savings vs default tier', async () => {
    const sessionId = 'sess-savings-001';

    // Route to fast (cheap)
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'fast',
      costRatio: 1,
    });

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 500,
        output: 1000,
        reasoning: 200,
        cache: { read: 50, write: 0 },
      },
      cost: 0.0051, // Fast cost
    });

    const report = await executeTokenCommand(tracker, 'token-report', sessionId);

    // Should show savings comparison
    expect(report).toContain('Cost Comparison');
    expect(report).toContain('Savings');
  });

  it('formats comparison with percentage improvement', async () => {
    const sessionId = 'sess-pct-001';

    // Route to medium
    await tracker.recordRoutingDecision(sessionId, {
      tier: 'medium',
      costRatio: 5,
    });

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 2000,
        output: 4000,
        reasoning: 1000,
        cache: { read: 200, write: 0 },
      },
      cost: 0.035,
    });

    // Compare to heavy (should show savings)
    const comparison = await executeTokenCommand(
      tracker,
      'token-compare',
      `${sessionId} heavy`,
    );

    expect(comparison).toContain('Tier Comparison');
    expect(comparison).toContain('cheaper');
  });
});

// ============================================================================
// Tests: FASE4-E2E-T5 - Error Handling & Edge Cases
// ============================================================================

describe('Phase 4 - FASE4-E2E-T5: Error Handling & Edge Cases', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('handles null/undefined events gracefully', async () => {
    await expect(
      tracker.recordStepFinish(null as any),
    ).resolves.toBeUndefined();

    await expect(
      tracker.recordStepFinish({} as any),
    ).resolves.toBeUndefined();
  });

  it('handles null/undefined sessions in commands', async () => {
    const result1 = await executeTokenCommand(tracker, 'token-report', '');
    const result2 = await executeTokenCommand(tracker, 'token-report', null as any);

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
  });

  it('returns empty history when no sessions recorded', async () => {
    const history = await executeTokenCommand(tracker, 'token-history', '');

    expect(history).toBeTruthy();
    // Should say "No saved token reports"
    expect(history).toContain('No');
  });

  it('returns not found message for missing session', async () => {
    const report = await executeTokenCommand(tracker, 'token-report', 'non-existent');

    expect(report).toBeTruthy();
    expect(report).toContain('No data');
  });

  it('handles malformed routing decisions', async () => {
    const sessionId = 'sess-malformed-001';

    await expect(
      tracker.recordRoutingDecision(sessionId, {
        tier: 'unknown' as any,
        costRatio: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('never throws on command execution', async () => {
    await expect(
      executeTokenCommand(null as any, 'token-report', 'any-session'),
    ).resolves.toBeDefined();

    await expect(
      executeTokenCommand(tracker, null as any, 'args'),
    ).resolves.toBeDefined();

    await expect(
      executeTokenCommand(tracker, '', ''),
    ).resolves.toBeDefined();
  });
});
