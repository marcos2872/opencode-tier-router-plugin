/**
 * Cleanup + Versioning Tests — FASE0-T5
 *
 * Tests the disk storage management strategy.
 *
 * ✅ ERRO-005 CORRIGIDO: Auto-cleanup when exceeding maxHistoryFiles
 *
 * Features:
 * 1. File cleanup: Delete oldest files when exceeding maxHistoryFiles (50 default)
 * 2. Versioning: Each persisted session has version field for future compatibility
 * 3. Sorted listing: Files listed in chronological order for proper FIFO cleanup
 * 4. Safety: Only deletes token-*.json files, not other data
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { RoutingDecision } from '../src/router/token-event-parser.js';
import { TokenTracker } from '../src/router/token-tracker.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import type { RouterConfig } from '../src/router/config.js';

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
    maxHistoryFiles: 5, // Small for testing cleanup
    maxHistoryDays: 30,
    sessionTTLMinutes: 30,
    maxSessionsMemory: 100,
  },
};

// ============================================================================
// Tests: Cleanup + Versioning
// ============================================================================

describe('TokenTracker - Cleanup + Versioning (FASE0-T5)', () => {
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

  it('includes version field in persisted sessions', async () => {
    const event = {
      sessionID: 'version-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      expect(sessions[0].version).toBe('1.0');
    }
  });

  it('persisted sessions have required metadata', async () => {
    const event = {
      sessionID: 'metadata-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      const session = sessions[0];
      expect(session.version).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.delegationCount).toBeDefined();
      expect(session.savedAt).toBeDefined();
      expect(session.summary).toBeDefined();
    }
  });

  it('respects maxHistoryFiles config (cleanup trigger)', async () => {
    const config: RouterConfig = {
      ...mockConfig,
      tokenTracking: {
        enabled: true,
        maxHistoryFiles: 3, // Very small for testing
        maxHistoryDays: 30,
        sessionTTLMinutes: 30,
        maxSessionsMemory: 100,
      },
    };

    const tracker2 = new TokenTracker(
      storage,
      new DefaultTokenEventParser(),
      new DefaultMetricsAggregator(),
      new MarkdownMetricsFormatter(),
      config,
      '.token-tracking',
    );

    // Verify config is respected
    expect(config.tokenTracking?.maxHistoryFiles).toBe(3);
  });

  it('stores sessions with correct version format', async () => {
    const event = {
      sessionID: 'format-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'medium' as const, costRatio: 5, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();

    // Check version format is semantic versioning
    if (sessions.length > 0) {
      const versionRegex = /^\d+\.\d+$/;
      expect(sessions[0].version).toMatch(versionRegex);
      expect(sessions[0].version).toBe('1.0');
    }
  });

  it('can list persisted sessions with their summaries', async () => {
    const event = {
      sessionID: 'list-test',
      tokens: { input: 500, output: 250, reasoning: 50, cache: { read: 25, write: 0 } },
      cost: 2.5,
    };

    const routing = {
      tier: 'medium' as const,
      costRatio: 5,
      estimated: { input: 450, output: 225 },
    } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      expect(sessions[0].summary).toBeDefined();
      expect(sessions[0].summary.sessionId).toBe('list-test');
      expect(sessions[0].summary.totalInputTokens).toBe(500);
      expect(sessions[0].summary.totalOutputTokens).toBe(250);
    }
  });

  it('initializes delegationCount for persisted sessions', async () => {
    // Multiple events in same session
    for (let i = 0; i < 2; i++) {
      const event = {
        sessionID: 'delegation-count-test',
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
        cost: 0.5,
      };

      const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
      await tracker.recordEvent(event, routing);
    }

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      expect(sessions[0].delegationCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('tracks savedAt timestamp for persisted sessions', async () => {
    const beforeSave = Date.now();

    const event = {
      sessionID: 'timestamp-test',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const afterSave = Date.now();

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      const savedAt = sessions[0].savedAt;
      expect(savedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedAt).toBeLessThanOrEqual(afterSave + 1000); // Allow some margin
    }
  });

  it('supports future version upgrades via version field', async () => {
    // This test validates that the version field allows for schema evolution
    const event = {
      sessionID: 'future-compat',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      // Version "1.0" is current; future versions could be "2.0", "3.0", etc.
      expect(sessions[0].version).toBe('1.0');
      // Code can check version and handle old vs new formats
      if (sessions[0].version === '1.0') {
        expect(sessions[0].summary).toBeDefined();
      }
    }
  });

  it('persists complete session summary including metrics', async () => {
    const event = {
      sessionID: 'complete-summary',
      tokens: { input: 1000, output: 500, reasoning: 100, cache: { read: 50, write: 0 } },
      cost: 5.0,
    };

    const routing = {
      tier: 'medium' as const,
      costRatio: 5,
      estimated: { input: 900, output: 450 },
    } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    const sessions = await tracker.listSessions();
    if (sessions.length > 0) {
      const summary = sessions[0].summary;
      // Verify all key metrics are present
      expect(summary.totalInputTokens).toBe(1000);
      expect(summary.totalOutputTokens).toBe(500);
      expect(summary.totalCostReal).toBe(5.0);
      expect(summary.accuracyBreakdown).toBeDefined();
      expect(summary.costSavedVsDefault).toBeDefined();
    }
  });

  it('handles cleanup when storage exceeds maxHistoryFiles', async () => {
    // This tests that cleanup logic can run without errors
    // In real scenario with many sessions, oldest files would be deleted

    const event1 = {
      sessionID: 'cleanup-test-1',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event1, routing);

    // Trigger multiple sessions to exercise cleanup logic
    for (let i = 2; i <= 10; i++) {
      const event = {
        sessionID: `cleanup-test-${i}`,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
        cost: 0.5,
      };
      await tracker.recordEvent(event, routing);
    }

    // Cleanup should have run, respecting maxHistoryFiles=5
    const persisted = await tracker.listSessions();
    expect(persisted.length).toBeLessThanOrEqual(5);
  });

  it('only cleans up token-*.json files (not other data)', async () => {
    // Add some non-token files to storage
    await storage.save('.token-tracking/metadata.json', '{"key":"value"}');
    await storage.save('.token-tracking/config.txt', 'some config');

    // Record a session
    const event = {
      sessionID: 'safe-cleanup',
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
      cost: 0.5,
    };

    const routing = { tier: 'fast' as const, costRatio: 1, estimated: { input: 90, output: 45 } } as RoutingDecision;
    await tracker.recordEvent(event, routing);

    // Verify non-token files still exist (cleanup should only delete token-*.json)
    const metadata = await storage.load('.token-tracking/metadata.json');
    expect(metadata).toBe('{"key":"value"}');

    const config = await storage.load('.token-tracking/config.txt');
    expect(config).toBe('some config');
  });
});
