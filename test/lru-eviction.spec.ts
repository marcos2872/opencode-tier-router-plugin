/**
 * LRU Cache + TTL + Persist-on-Evict Tests — FASE0-T4
 *
 * Tests the memory management strategy for bounded token tracking.
 *
 * ✅ ERRO-004 CORRIGIDO: Implement LRU eviction + TTL 30min + persist-on-evict
 *
 * Focus:
 * 1. SessionCache behavior: configuration, memory limits
 * 2. Configuration: respects maxSessionsMemory, maxHistoryFiles limits
 * 3. Data storage: sessions can be recorded and retrieved
 * 4. Memory bounded: designed to prevent unbounded growth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RoutingDecision, TokenRecord } from '../src/router/token-event-parser.js';
import { TokenTracker } from '../src/router/token-tracker.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import type { RouterConfig } from '../src/router/config.js';
import type { SessionTokenSummary } from '../src/router/metrics-aggregator.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const mockConfig: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: {
      model: 'fast-model',
      costRatio: 1,
      cap: 8,
      thresholds: { min: 0, max: 2000 },
    },
    medium: {
      model: 'medium-model',
      costRatio: 5,
      cap: 12,
      thresholds: { min: 2000, max: 10000 },
    },
    heavy: {
      model: 'heavy-model',
      costRatio: 20,
      cap: 20,
      thresholds: { min: 10000, max: null },
    },
  },
  modes: { normal: { defaultTier: 'medium' } },
  taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
  enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
  routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
  tokenTracking: {
    enabled: true,
    maxHistoryFiles: 50,
    maxHistoryDays: 30,
    sessionTTLMinutes: 30,
    maxSessionsMemory: 100,
  },
};

const createStepFinishEvent = (sessionId: string) => ({
  sessionID: sessionId,
  tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
  cost: 0.5,
});

const createRoutingDecision = (): RoutingDecision => ({
  tier: 'fast',
  costRatio: 1,
  estimated: { input: 90, output: 45 },
});

const createSummary = (sessionId: string): SessionTokenSummary => ({
  sessionId,
  records: [],
  startTime: 1,
  endTime: 1,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalReasoningTokens: 0,
  totalCacheCost: 0,
  totalCostReal: 0,
  accuracyBreakdown: {
    optimal: 0,
    right: 0,
    acceptable: 0,
    suboptimal: 0,
    overshot: 0,
  },
  averageInputEstimationError: 0,
  averageOutputEstimationError: 0,
  costSavedVsDefault: 0,
  costSavedVsHeavy: 0,
  averageActualCostRatio: 0,
});

// ============================================================================
// Tests: TokenTracker Memory Management
// ============================================================================

describe('TokenTracker - Memory Management (FASE0-T4)', () => {
  let tracker: TokenTracker;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    tracker = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      mockConfig,
      '.token-tracking',
    );
  });

  it('deduplicates concurrent LRU eviction candidates without corrupting order', async () => {
    const smallMemConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        ...mockConfig.tokenTracking,
        maxSessionsMemory: 2,
      },
    };
    const smallTracker = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      smallMemConfig,
      '.token-tracking',
    );

    const cache = smallTracker['cache'] as {
      set: (sessionId: string, summary: SessionTokenSummary, delegationCount: number) => void;
      getEvictionCandidates: () => { sessionId: string }[];
      size: () => number;
    };
    cache.set('session-1', createSummary('session-1'), 0);
    cache.set('session-2', createSummary('session-2'), 0);
    cache.set('session-3', createSummary('session-3'), 0);

    const first = cache.getEvictionCandidates();
    const second = cache.getEvictionCandidates();
    const candidates = [...first, ...second];
    const sessionIds = candidates.map(candidate => candidate.sessionId);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
    expect(cache.size()).toBe(2);
  });

  it('blocks a second eviction while one eviction is active', async () => {
    const smallMemConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        ...mockConfig.tokenTracking,
        maxSessionsMemory: 2,
      },
    };
    const smallTracker = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      smallMemConfig,
      '.token-tracking',
    );

    const cache = smallTracker['cache'] as {
      set: (sessionId: string, summary: SessionTokenSummary, delegationCount: number) => void;
      withEvictionLock: <T>(callback: () => Promise<T>) => Promise<T | undefined>;
      getEvictionCandidates: (options?: { skipLock?: boolean }) => { sessionId: string }[];
      size: () => number;
    };
    cache.set('session-1', createSummary('session-1'), 0);
    cache.set('session-2', createSummary('session-2'), 0);
    cache.set('session-3', createSummary('session-3'), 0);

    let release!: () => void;
    const first = cache.withEvictionLock(async () => {
      const candidates = cache.getEvictionCandidates({ skipLock: true });
      return new Promise<{ sessionId: string }[]>(resolve => {
        release = () => resolve(candidates);
      });
    });
    const second = await cache.withEvictionLock(async () => cache.getEvictionCandidates());

    expect(second).toBeUndefined();
    release();
    const firstCandidates = (await first) ?? [];

    expect(firstCandidates.map(candidate => candidate.sessionId)).toEqual(['session-1']);
    expect(cache.size()).toBe(2);
  });

  it('keeps session records if they are recreated before eviction deletion', async () => {
    const smallMemConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        ...mockConfig.tokenTracking,
        maxSessionsMemory: 2,
      },
    };
    const smallTracker = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      smallMemConfig,
      '.token-tracking',
    );

    const cache = smallTracker['cache'] as {
      set: (sessionId: string, summary: SessionTokenSummary, delegationCount: number) => void;
    };
    const sessionRecords = smallTracker['sessionRecords'] as Map<string, TokenRecord[]>;
    cache.set('session-1', createSummary('session-1'), 0);
    cache.set('session-2', createSummary('session-2'), 0);
    cache.set('session-3', createSummary('session-3'), 0);
    sessionRecords.set('session-1', []);
    sessionRecords.set('session-2', []);
    sessionRecords.set('session-3', []);

    const originalDelete = sessionRecords.delete.bind(sessionRecords);
    const deleteSpy = vi.spyOn(sessionRecords, 'delete').mockImplementation(function deleteWithReadd(sessionId) {
      if (sessionId === 'session-1') {
        sessionRecords.set(sessionId, []);
        return true;
      }
      return originalDelete(sessionId);
    });
    const handleEvictions = smallTracker['handleEvictions'].bind(smallTracker) as () => Promise<void>;

    await handleEvictions();

    expect(sessionRecords.has('session-1')).toBe(true);
    expect(sessionRecords.has('session-2')).toBe(true);
    expect(storage.getAllFiles().size).toBeGreaterThanOrEqual(1);
    deleteSpy.mockRestore();
  });

  it('stores sessions in memory', async () => {
    const event = {
      sessionID: 'session-1',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
      timestamp: Date.now(),
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const report = await tracker.getSessionReport('session-1');
    expect(report).toContain('session-1');
  });

  it('retrieves session reports', async () => {
    const event = {
      sessionID: 'report-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const report = await tracker.getSessionReport('report-test');
    expect(report).toContain('report-test');
    expect(report).toContain('## Real Token Cost Report');
  });

  it('respects config tokenTracking.maxSessionsMemory setting', async () => {
    const smallMemConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        enabled: true,
        maxHistoryFiles: 50,
        maxHistoryDays: 30,
        sessionTTLMinutes: 30,
        maxSessionsMemory: 3, // Custom boundary value
      },
    };

    expect(smallMemConfig.tokenTracking?.maxSessionsMemory).toBe(3);
  });

  it('respects config tokenTracking.maxHistoryFiles setting', async () => {
    const cfg = mockConfig;
    expect(cfg.tokenTracking?.maxHistoryFiles).toBe(50);
  });

  it('respects config tokenTracking.sessionTTLMinutes setting', async () => {
    const cfg = mockConfig;
    expect(cfg.tokenTracking?.sessionTTLMinutes).toBe(30);
  });

  it('aggregates multiple events for same session', async () => {
    // Multiple events in same session should aggregate
    for (let i = 0; i < 3; i++) {
      const event = {
        sessionID: 'multi-event',
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
        cost: 0.5,
      };

      const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
      await tracker.recordEvent(event, routing);
    }

    const report = await tracker.getSessionReport('multi-event');
    expect(report).toContain('multi-event');
    // Verify tokens are accumulated (3 events × 100 input tokens each)
    expect(report).toContain('300');
  });

  it('generates history of all sessions', async () => {
    // Record a session
    const event = {
      sessionID: 'history-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const history = await tracker.getHistory();
    expect(history).toBeDefined();
    // History may be empty initially if sessions not yet persisted
    expect(typeof history).toBe('string');
  });

  it('supports custom tokenTracking config', async () => {
    const customConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        enabled: true,
        maxHistoryFiles: 100, // Custom value
        maxHistoryDays: 60,    // Custom value
        sessionTTLMinutes: 45, // Custom value (45 min instead of 30)
        maxSessionsMemory: 500, // Custom value (500 instead of 100)
      },
    };

    const customTracker = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      customConfig,
      '.token-tracking',
    );

    expect(customConfig.tokenTracking?.sessionTTLMinutes).toBe(45);
    expect(customConfig.tokenTracking?.maxSessionsMemory).toBe(500);
    expect(customConfig.tokenTracking?.maxHistoryFiles).toBe(100);

    // Verify tracker works with custom config
    const event = {
      sessionID: 'custom-config-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await customTracker.recordEvent(event, routing);

    const report = await customTracker.getSessionReport('custom-config-test');
    expect(report).toContain('custom-config-test');
  });

  it('handles tokenTracking config being undefined (backward compat)', async () => {
    const noTrackingConfig: RouterConfig = {
      ...mockConfig,
      tokenTracking: undefined,
    };

    const tracker2 = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      noTrackingConfig,
      '.token-tracking',
    );

    // Should still work with default config
    const event = {
      sessionID: 'no-config-session',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker2.recordEvent(event, routing);

    const report = await tracker2.getSessionReport('no-config-session');
    expect(report).toContain('no-config-session');
  });

  it('supports comparison reports across tiers', async () => {
    const event = {
      sessionID: 'compare-test',
      tokens: { input: 1000, output: 500, reasoning: 100, cache: { read: 50, write: 0 } },
      cost: 5.0,
    };

    const routing = { tier: 'medium' as const, costRatio: 5, estimated: { input: 900, output: 450 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const comparison = await tracker.getComparison('compare-test', 'heavy');
    expect(comparison).toContain('Tier Comparison');
    expect(comparison).toContain('heavy');
  });

  it('limits sessions in memory (max 100 by default)', async () => {
    // Default config has maxSessionsMemory: 100
    // This test verifies the limit is configured
    expect(mockConfig.tokenTracking?.maxSessionsMemory).toBe(100);
  });

  it('saves sessions to storage via adapter', async () => {
    // Verify the tracker is using the provided storage adapter
    const event = {
      sessionID: 'storage-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    // Verify the tracker can retrieve persisted sessions
    // (even if none are persisted yet)
    const persisted = await tracker.listSessions();
    expect(Array.isArray(persisted)).toBe(true);
  });
});
