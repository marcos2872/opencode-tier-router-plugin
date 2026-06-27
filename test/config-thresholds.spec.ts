/**
 * Config-Driven Thresholds Tests — FASE0-T3
 *
 * Tests the configuration-driven tier accuracy thresholds.
 *
 * ✅ ERRO-003 CORRIGIDO: Move hardcoded thresholds (2000, 10000) to tiers.json
 *
 * Scenarios:
 * 1. Default thresholds: fast (0-2000), medium (2000-10000), heavy (10000+)
 * 2. Custom thresholds: load from config and apply
 * 3. Boundary testing: exactly at min/max, just below/above
 * 4. Null handling: max=null means unlimited
 * 5. Validation: reject invalid threshold configs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateConfig,
  type RouterConfig,
  type TierConfig,
  type TokenThresholds,
  ConfigError,
} from '../src/router/config.js';
import { DefaultMetricsAggregator } from '../src/router/metrics-aggregator.js';

// ============================================================================
// Tests: Config Validation with Thresholds
// ============================================================================

describe('Config Validation - Thresholds (FASE0-T3)', () => {
  it('accepts valid thresholds in config', () => {
    const config = {
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
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts config without thresholds (optional field)', () => {
    const config = {
      mode: 'normal',
      tiers: {
        fast: { model: 'fast-model', costRatio: 1, cap: 8 },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: { model: 'heavy-model', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('rejects thresholds with invalid min (negative)', () => {
    const config = {
      mode: 'normal',
      tiers: {
        fast: {
          model: 'fast-model',
          costRatio: 1,
          cap: 8,
          thresholds: { min: -100, max: 2000 }, // ❌ negative min
        },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: { model: 'heavy-model', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    expect(() => validateConfig(config)).toThrow(ConfigError);
  });

  it('rejects thresholds with max < min', () => {
    const config = {
      mode: 'normal',
      tiers: {
        fast: {
          model: 'fast-model',
          costRatio: 1,
          cap: 8,
          thresholds: { min: 5000, max: 2000 }, // ❌ max < min
        },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: { model: 'heavy-model', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    expect(() => validateConfig(config)).toThrow(ConfigError);
  });

  it('accepts max=null (unlimited upper bound)', () => {
    const config = {
      mode: 'normal',
      tiers: {
        fast: { model: 'fast-model', costRatio: 1, cap: 8 },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: {
          model: 'heavy-model',
          costRatio: 20,
          cap: 20,
          thresholds: { min: 10000, max: null }, // ✅ unlimited
        },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('rejects invalid threshold type (not object)', () => {
    const config = {
      mode: 'normal',
      tiers: {
        fast: {
          model: 'fast-model',
          costRatio: 1,
          cap: 8,
          thresholds: 'invalid', // ❌ string instead of object
        },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: { model: 'heavy-model', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    expect(() => validateConfig(config)).toThrow(ConfigError);
  });
});

// ============================================================================
// Tests: MetricsAggregator with Config Thresholds
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
};

describe('MetricsAggregator - Threshold-Based Accuracy', () => {
  let aggregator: DefaultMetricsAggregator;

  beforeEach(() => {
    aggregator = new DefaultMetricsAggregator();
  });

  it('calculates accuracy: tokens within fast range (0-2000)', () => {
    const accuracy1 = aggregator.calculateTierAccuracy(1000, 'fast', mockConfig);
    expect(accuracy1).toBe('RIGHT');

    const accuracy2 = aggregator.calculateTierAccuracy(2000, 'fast', mockConfig);
    expect(accuracy2).toBe('RIGHT');

    const accuracy3 = aggregator.calculateTierAccuracy(0, 'fast', mockConfig);
    expect(accuracy3).toBe('RIGHT');
  });

  it('calculates accuracy: tokens below fast range (< 0) → ACCEPTABLE', () => {
    // tokens in (0, 2000) on medium → ACCEPTABLE (over-provisioned but safe)
    const accuracy = aggregator.calculateTierAccuracy(1500, 'medium', mockConfig);
    expect(accuracy).toBe('ACCEPTABLE'); // Below medium min (2000), but over-provisioned is ok
  });

  it('calculates accuracy: tokens above fast max → OVERSHOT', () => {
    const accuracy = aggregator.calculateTierAccuracy(3000, 'fast', mockConfig);
    expect(accuracy).toBe('OVERSHOT'); // 3000 > 2000 (fast max)
  });

  it('calculates accuracy: tokens within medium range (2000-10000)', () => {
    const accuracy1 = aggregator.calculateTierAccuracy(2000, 'medium', mockConfig);
    expect(accuracy1).toBe('RIGHT');

    const accuracy2 = aggregator.calculateTierAccuracy(5000, 'medium', mockConfig);
    expect(accuracy2).toBe('RIGHT');

    const accuracy3 = aggregator.calculateTierAccuracy(10000, 'medium', mockConfig);
    expect(accuracy3).toBe('RIGHT');
  });

  it('calculates accuracy: tokens above medium max → OVERSHOT', () => {
    const accuracy = aggregator.calculateTierAccuracy(15000, 'medium', mockConfig);
    expect(accuracy).toBe('OVERSHOT'); // 15000 > 10000 (medium max)
  });

  it('calculates accuracy: tokens within heavy range (10000+)', () => {
    const accuracy1 = aggregator.calculateTierAccuracy(10000, 'heavy', mockConfig);
    expect(accuracy1).toBe('RIGHT');

    const accuracy2 = aggregator.calculateTierAccuracy(50000, 'heavy', mockConfig);
    expect(accuracy2).toBe('RIGHT');

    const accuracy3 = aggregator.calculateTierAccuracy(1000000, 'heavy', mockConfig);
    expect(accuracy3).toBe('RIGHT'); // Unlimited (max=null)
  });

  it('calculates accuracy: unknown tier → UNKNOWN', () => {
    const accuracy = aggregator.calculateTierAccuracy(5000, 'unknown', mockConfig);
    expect(accuracy).toBe('UNKNOWN');
  });

  it('respects custom thresholds in config', () => {
    const customConfig: RouterConfig = {
      ...mockConfig,
      tiers: {
        fast: {
          model: 'fast-model',
          costRatio: 1,
          cap: 8,
          thresholds: { min: 0, max: 5000 }, // Custom: 5000 instead of 2000
        },
        medium: {
          model: 'medium-model',
          costRatio: 5,
          cap: 12,
          thresholds: { min: 5000, max: 20000 },
        },
        heavy: {
          model: 'heavy-model',
          costRatio: 20,
          cap: 20,
          thresholds: { min: 20000, max: null },
        },
      },
    };

    // 3000 tokens on fast with custom threshold (0-5000) → RIGHT
    const accuracy1 = aggregator.calculateTierAccuracy(3000, 'fast', customConfig);
    expect(accuracy1).toBe('RIGHT');

    // 3000 tokens on fast with original threshold (0-2000) → OVERSHOT
    const accuracy2 = aggregator.calculateTierAccuracy(3000, 'fast', mockConfig);
    expect(accuracy2).toBe('OVERSHOT');
  });
});

// ============================================================================
// Tests: Edge Cases and Boundaries
// ============================================================================

describe('MetricsAggregator - Threshold Boundaries', () => {
  let aggregator: DefaultMetricsAggregator;

  beforeEach(() => {
    aggregator = new DefaultMetricsAggregator();
  });

  it('handles boundary: token count exactly at min', () => {
    const accuracy = aggregator.calculateTierAccuracy(2000, 'medium', mockConfig);
    expect(accuracy).toBe('RIGHT'); // 2000 is medium min, should be within range
  });

  it('handles boundary: token count exactly at max', () => {
    const accuracy = aggregator.calculateTierAccuracy(10000, 'medium', mockConfig);
    expect(accuracy).toBe('RIGHT'); // 10000 is medium max, should be within range
  });

  it('handles boundary: token count just below min', () => {
    const accuracy = aggregator.calculateTierAccuracy(1999, 'medium', mockConfig);
    // 1999 < min(2000), so below medium range
    // On medium (not fast), below min → ACCEPTABLE (over-provisioned is safe)
    expect(accuracy).toBe('ACCEPTABLE');
  });

  it('handles boundary: token count just above max', () => {
    const accuracy = aggregator.calculateTierAccuracy(10001, 'medium', mockConfig);
    expect(accuracy).toBe('OVERSHOT'); // 10001 > max(10000)
  });

  it('handles zero tokens', () => {
    const accuracy = aggregator.calculateTierAccuracy(0, 'fast', mockConfig);
    expect(accuracy).toBe('RIGHT'); // 0 >= min(0) and 0 <= max(2000)
  });
});

// ============================================================================
// Tests: Config with No Thresholds (Backward Compatibility)
// ============================================================================

describe('MetricsAggregator - Backward Compatibility (No Thresholds)', () => {
  let aggregator: DefaultMetricsAggregator;

  beforeEach(() => {
    aggregator = new DefaultMetricsAggregator();
  });

  it('handles config without thresholds → UNKNOWN', () => {
    const noThresholdConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'fast-model', costRatio: 1, cap: 8 },
        medium: { model: 'medium-model', costRatio: 5, cap: 12 },
        heavy: { model: 'heavy-model', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: { strategy: 'keyword', selectorModel: 'fast', selectorTimeoutMs: 1000, selectorMaxTokens: 16 },
    };

    const accuracy = aggregator.calculateTierAccuracy(5000, 'medium', noThresholdConfig);
    expect(accuracy).toBe('UNKNOWN'); // No thresholds defined
  });
});
