/**
 * Phase 2 — New API Smoke Tests (RTT-T7..T8)
 *
 * Validates that new persistence API methods exist and can be called:
 * - getSummary(sessionId)
 * - persistTokenMetrics(sessionId)
 * - loadPersistedTokenMetrics(sessionId)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker } from '../src/router/token-tracker.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import type { RouterConfig } from '../src/router/config.js';

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

describe('Phase 2 - RTT-T7/T8: Persistence API Methods', () => {
  let tracker: TokenTracker;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  // ========================================
  // RTT-T7: getSummary() API exists and works
  // ========================================

  it('getSummary() method exists', async () => {
    expect(typeof tracker.getSummary).toBe('function');
  });

  it('getSummary() returns null for non-existent session', async () => {
    const result = await tracker.getSummary('does-not-exist');
    expect(result).toBeNull();
  });

  it('getSummary() accepts session ID parameter', async () => {
    // Should not throw
    await expect(tracker.getSummary('any-session-id')).resolves.toBeDefined();
  });

  // ========================================
  // RTT-T7: persistTokenMetrics() API exists
  // ========================================

  it('persistTokenMetrics() method exists', async () => {
    expect(typeof tracker.persistTokenMetrics).toBe('function');
  });

  it('persistTokenMetrics() can be called', async () => {
    // Should not throw
    await expect(tracker.persistTokenMetrics('session-123')).resolves.toBeUndefined();
  });

  it('persistTokenMetrics() handles missing session gracefully', async () => {
    // Should not throw even for non-existent session
    await expect(tracker.persistTokenMetrics('non-existent')).resolves.toBeUndefined();
  });

  // ========================================
  // RTT-T7: loadPersistedTokenMetrics() API exists
  // ========================================

  it('loadPersistedTokenMetrics() method exists', async () => {
    expect(typeof tracker.loadPersistedTokenMetrics).toBe('function');
  });

  it('loadPersistedTokenMetrics() returns null for missing file', async () => {
    const result = await tracker.loadPersistedTokenMetrics('non-existent');
    expect(result).toBeNull();
  });

  it('loadPersistedTokenMetrics() accepts session ID parameter', async () => {
    // Should not throw
    await expect(tracker.loadPersistedTokenMetrics('any-id')).resolves.toBeDefined();
  });

  // ========================================
  // RTT-T8: Integration - API works together
  // ========================================

  it('getSummary() returns null by default', async () => {
    const result = await tracker.getSummary('test-session');
    expect(result).toBeNull();
  });

  it('persistTokenMetrics() can be called multiple times', async () => {
    const sessionId = 'session-multi-persist';

    // Should not throw
    await tracker.persistTokenMetrics(sessionId);
    await tracker.persistTokenMetrics(sessionId);
    await tracker.persistTokenMetrics(sessionId);

    expect(true).toBe(true);
  });

  it('listSessions() still works after persist calls', async () => {
    await tracker.persistTokenMetrics('session-1');
    await tracker.persistTokenMetrics('session-2');

    const sessions = await tracker.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('getHistory() still works after persist calls', async () => {
    await tracker.persistTokenMetrics('session-1');

    const history = await tracker.getHistory();
    expect(typeof history).toBe('string');
  });

  // ========================================
  // Error handling
  // ========================================

  it('getSummary() never throws', async () => {
    await expect(tracker.getSummary(null as any)).resolves.toBeDefined();
    await expect(tracker.getSummary(undefined as any)).resolves.toBeDefined();
    await expect(tracker.getSummary('')).resolves.toBeDefined();
  });

  it('persistTokenMetrics() never throws', async () => {
    await expect(tracker.persistTokenMetrics(null as any)).resolves.toBeUndefined();
    await expect(tracker.persistTokenMetrics('')).resolves.toBeUndefined();
  });

  it('loadPersistedTokenMetrics() never throws', async () => {
    await expect(tracker.loadPersistedTokenMetrics(null as any)).resolves.toBeDefined();
    await expect(tracker.loadPersistedTokenMetrics('')).resolves.toBeDefined();
  });
});
