/**
 * Phase 3 — Commands Tests (RTT-T9..T12)
 *
 * Validates:
 * - /token-report <sessionId> command
 * - /token-history command
 * - /token-compare <sessionId> <tier> command
 * - Command parsing and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker } from '../src/router/token-tracker.js';
import { InMemoryStorage } from '../src/router/in-memory-storage.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from '../src/router/metrics-formatter.js';
import { DefaultTokenEventParser } from '../src/router/token-event-parser.js';
import {
  executeTokenCommand,
  isTokenCommand,
  getTokenCommandsHelp,
} from '../src/router/token-commands.js';
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

// ============================================================================
// Tests: RTT-T9 - /token-report command
// ============================================================================

describe('Phase 3 - RTT-T9: /token-report Command', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('executes /token-report with session ID', async () => {
    const sessionId = 'sess-001';

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

    const result = await executeTokenCommand(tracker, 'token-report', sessionId);

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns usage message if no session ID provided', async () => {
    const result = await executeTokenCommand(tracker, 'token-report', '');

    expect(result).toContain('Usage');
    expect(result).toContain('token-report');
  });

  it('returns report for non-existent session gracefully', async () => {
    const result = await executeTokenCommand(tracker, 'token-report', 'non-existent');

    // Should not throw, return some message
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('case-insensitive command matching', async () => {
    const sessionId = 'sess-case';

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

    const result1 = await executeTokenCommand(tracker, 'TOKEN-REPORT', sessionId);
    const result2 = await executeTokenCommand(tracker, 'Token-Report', sessionId);

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
  });

  it('handles session ID with whitespace', async () => {
    const sessionId = 'sess-002';

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

    // Args with extra whitespace
    const result = await executeTokenCommand(tracker, 'token-report', `  ${sessionId}  `);

    expect(result).toBeTruthy();
  });
});

// ============================================================================
// Tests: RTT-T10 - /token-history command
// ============================================================================

describe('Phase 3 - RTT-T10: /token-history Command', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('executes /token-history without arguments', async () => {
    const result = await executeTokenCommand(tracker, 'token-history', '');

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('ignores arguments to /token-history', async () => {
    const result1 = await executeTokenCommand(tracker, 'token-history', '');
    const result2 = await executeTokenCommand(tracker, 'token-history', 'some-arg');

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
  });

  it('case-insensitive command', async () => {
    const result1 = await executeTokenCommand(tracker, 'TOKEN-HISTORY', '');
    const result2 = await executeTokenCommand(tracker, 'Token-History', '');

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
  });

  it('returns string even when no sessions persisted', async () => {
    const result = await executeTokenCommand(tracker, 'token-history', '');

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

// ============================================================================
// Tests: RTT-T11 - /token-compare command
// ============================================================================

describe('Phase 3 - RTT-T11: /token-compare Command', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('executes /token-compare with session ID and tier', async () => {
    const sessionId = 'sess-compare-001';

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

    const result = await executeTokenCommand(
      tracker,
      'token-compare',
      `${sessionId} medium`,
    );

    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns usage message if missing session ID', async () => {
    const result = await executeTokenCommand(tracker, 'token-compare', 'medium');

    expect(result).toContain('Usage');
    expect(result).toContain('token-compare');
  });

  it('returns usage message if missing tier', async () => {
    const result = await executeTokenCommand(tracker, 'token-compare', 'sess-001');

    expect(result).toContain('Usage');
  });

  it('returns error message for invalid tier', async () => {
    const result = await executeTokenCommand(
      tracker,
      'token-compare',
      'sess-001 invalid-tier',
    );

    expect(result).toContain('Invalid tier');
    expect(result).toContain('fast');
    expect(result).toContain('medium');
    expect(result).toContain('heavy');
  });

  it('accepts all valid tiers', async () => {
    const sessionId = 'sess-tiers';

    await tracker.recordStepFinish({
      sessionID: sessionId,
      tokens: {
        input: 5000,
        output: 10000,
        reasoning: 2000,
        cache: { read: 500, write: 0 },
      },
      cost: 0.05,
    });

    for (const tier of ['fast', 'medium', 'heavy']) {
      const result = await executeTokenCommand(
        tracker,
        'token-compare',
        `${sessionId} ${tier}`,
      );

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    }
  });

  it('case-insensitive command and tier', async () => {
    const sessionId = 'sess-case-compare';

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

    const result1 = await executeTokenCommand(
      tracker,
      'TOKEN-COMPARE',
      `${sessionId} MEDIUM`,
    );
    const result2 = await executeTokenCommand(
      tracker,
      'Token-Compare',
      `${sessionId} Medium`,
    );

    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
  });
});

// ============================================================================
// Tests: Command Detection & Help
// ============================================================================

describe('Phase 3 - RTT-T12: Command Detection & Help', () => {
  it('isTokenCommand() detects token commands', () => {
    expect(isTokenCommand('token-report')).toBe(true);
    expect(isTokenCommand('token-history')).toBe(true);
    expect(isTokenCommand('token-compare')).toBe(true);
  });

  it('isTokenCommand() case-insensitive', () => {
    expect(isTokenCommand('TOKEN-REPORT')).toBe(true);
    expect(isTokenCommand('Token-History')).toBe(true);
    expect(isTokenCommand('TOKEN-COMPARE')).toBe(true);
  });

  it('isTokenCommand() strips leading slash', () => {
    expect(isTokenCommand('/token-report')).toBe(true);
    expect(isTokenCommand('/token-history')).toBe(true);
    expect(isTokenCommand('/token-compare')).toBe(true);
  });

  it('isTokenCommand() rejects unknown commands', () => {
    expect(isTokenCommand('other-command')).toBe(false);
    expect(isTokenCommand('token-unknown')).toBe(false);
    expect(isTokenCommand('/help')).toBe(false);
  });

  it('getTokenCommandsHelp() returns help text', () => {
    const help = getTokenCommandsHelp();

    expect(help).toContain('token-report');
    expect(help).toContain('token-history');
    expect(help).toContain('token-compare');
  });

  it('getTokenCommandsHelp() includes examples', () => {
    const help = getTokenCommandsHelp();

    expect(help).toContain('Example');
    expect(help).toContain('sess-');
  });

  it('getTokenCommandsHelp() describes tiers', () => {
    const help = getTokenCommandsHelp();

    expect(help).toContain('fast');
    expect(help).toContain('medium');
    expect(help).toContain('heavy');
  });
});

// ============================================================================
// Tests: Unknown Command Handling
// ============================================================================

describe('Phase 3 - RTT-T12: Unknown Command Handling', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    const parser = new DefaultTokenEventParser();
    const aggregator = new DefaultMetricsAggregator();
    const formatter = new MarkdownMetricsFormatter();

    tracker = new TokenTracker(storage, parser, aggregator, formatter, TEST_CONFIG);
  });

  it('returns null for unknown command', async () => {
    const result = await executeTokenCommand(tracker, 'unknown-command', '');

    expect(result).toBeNull();
  });

  it('returns null for random command', async () => {
    const result = await executeTokenCommand(tracker, 'random-stuff', 'args');

    expect(result).toBeNull();
  });

  it('executeTokenCommand never throws', async () => {
    await expect(
      executeTokenCommand(tracker, 'invalid', 'args'),
    ).resolves.toBeDefined();

    await expect(
      executeTokenCommand(tracker, '', ''),
    ).resolves.toBeDefined();

    await expect(
      executeTokenCommand(tracker, null as any, ''),
    ).resolves.toBeDefined();
  });
});
