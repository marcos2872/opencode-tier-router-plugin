/**
 * Enforcement Validator Tests
 *
 * Validates that the plugin ALWAYS delegates to subagents.
 * Ensures no task can escape delegation to the main window.
 *
 * Critical validation:
 * 1. enforcement.mode = "hard-block" (not "advisory")
 * 2. enforcement.trivialDirectAllowed = false (NEVER allow direct execution)
 * 3. All 3 tiers configured with valid models
 * 4. Cost hierarchy: fast < medium < heavy
 * 5. Comprehensive task pattern coverage
 */

import { describe, it, expect } from 'vitest';
import {
  validateEnforcement,
  assertEnforcement,
  reportEnforcement,
  type EnforcementValidation,
} from '../src/router/enforcement-validator.js';
import type { RouterConfig } from '../src/router/config.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_CONFIG: RouterConfig = {
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
    fast: ['find', 'search', 'grep', 'locate', 'list', 'read', 'show'],
    medium: ['implement', 'add', 'write', 'fix', 'update', 'create', 'edit', 'refactor'],
    heavy: ['design', 'architecture', 'debug', 'complex', 'analyze', 'review', 'optimize', 'explain'],
  },
  enforcement: {
    mode: 'hard-block',
    trivialDirectAllowed: false, // ✅ MUST be false
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

// ============================================================================
// Tests: Critical Enforcement Rules
// ============================================================================

describe('Enforcement Validator - 100% Delegation', () => {
  it('accepts valid 100% delegation config', () => {
    const validation = validateEnforcement(VALID_CONFIG);

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('REJECTS advisory mode (only hard-block allowed)', () => {
    const badConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    const validation = validateEnforcement(badConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('hard-block'))).toBe(true);
  });

  it('REJECTS trivialDirectAllowed=true (never allow bypass)', () => {
    const badConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    const validation = validateEnforcement(badConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('trivialDirectAllowed'))).toBe(true);
  });

  it('enforces correct cost hierarchy: fast < medium < heavy', () => {
    // Violation: fast >= medium
    const badCostConfig1: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        ...VALID_CONFIG.tiers,
        fast: { ...VALID_CONFIG.tiers.fast, costRatio: 5 }, // 5 >= 5 (medium)
      },
    };

    const validation1 = validateEnforcement(badCostConfig1);
    expect(validation1.isValid).toBe(false);
    expect(validation1.errors.some((e) => e.includes('hierarchy'))).toBe(true);

    // Violation: medium >= heavy
    const badCostConfig2: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        ...VALID_CONFIG.tiers,
        medium: { ...VALID_CONFIG.tiers.medium, costRatio: 20 }, // 20 >= 20 (heavy)
      },
    };

    const validation2 = validateEnforcement(badCostConfig2);
    expect(validation2.isValid).toBe(false);
    expect(validation2.errors.some((e) => e.includes('hierarchy'))).toBe(true);
  });
});

// ============================================================================
// Tests: Tier Configuration
// ============================================================================

describe('Enforcement Validator - Tier Configuration', () => {
  it('requires all 3 tiers (fast, medium, heavy)', () => {
    const missingTier: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        fast: VALID_CONFIG.tiers.fast,
        medium: VALID_CONFIG.tiers.medium,
        // ❌ missing heavy
      } as any,
    };

    const validation = validateEnforcement(missingTier);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('Missing tier'))).toBe(true);
  });

  it('requires valid model format "provider/model" for each tier', () => {
    const invalidModel: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        ...VALID_CONFIG.tiers,
        fast: { ...VALID_CONFIG.tiers.fast, model: 'invalid-model' },
      },
    };

    const validation = validateEnforcement(invalidModel);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('Invalid model'))).toBe(true);
  });

  it('requires positive costRatio for each tier', () => {
    const zeroCost: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        ...VALID_CONFIG.tiers,
        fast: { ...VALID_CONFIG.tiers.fast, costRatio: 0 },
      },
    };

    const validation = validateEnforcement(zeroCost);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('costRatio'))).toBe(true);
  });

  it('requires positive cap for each tier', () => {
    const zeroCap: RouterConfig = {
      ...VALID_CONFIG,
      tiers: {
        ...VALID_CONFIG.tiers,
        medium: { ...VALID_CONFIG.tiers.medium, cap: 0 },
      },
    };

    const validation = validateEnforcement(zeroCap);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('cap'))).toBe(true);
  });
});

// ============================================================================
// Tests: Task Pattern Coverage
// ============================================================================

describe('Enforcement Validator - Task Pattern Coverage', () => {
  it('warns if fast patterns are too sparse', () => {
    const sparsePatterns: RouterConfig = {
      ...VALID_CONFIG,
      taskPatterns: {
        ...VALID_CONFIG.taskPatterns,
        fast: ['search'], // Only 1 pattern
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.warnings.some((w) => w.includes('fast patterns'))).toBe(true);
  });

  it('warns if medium patterns are too sparse', () => {
    const sparsePatterns: RouterConfig = {
      ...VALID_CONFIG,
      taskPatterns: {
        ...VALID_CONFIG.taskPatterns,
        medium: ['implement', 'fix'], // Only 2 patterns
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.warnings.some((w) => w.includes('medium patterns'))).toBe(true);
  });

  it('warns if heavy patterns are too sparse', () => {
    const sparsePatterns: RouterConfig = {
      ...VALID_CONFIG,
      taskPatterns: {
        ...VALID_CONFIG.taskPatterns,
        heavy: ['design', 'debug'], // Only 2 patterns
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.warnings.some((w) => w.includes('heavy patterns'))).toBe(true);
  });
});

// ============================================================================
// Tests: Routing Strategy
// ============================================================================

describe('Enforcement Validator - Routing Strategy', () => {
  it('accepts keyword routing strategy', () => {
    const validation = validateEnforcement(VALID_CONFIG);

    expect(validation.isValid).toBe(true);
  });

  it('accepts llm routing strategy', () => {
    const llmConfig: RouterConfig = {
      ...VALID_CONFIG,
      routing: { ...VALID_CONFIG.routing, strategy: 'llm' },
    };

    const validation = validateEnforcement(llmConfig);

    expect(validation.isValid).toBe(true);
  });

  it('rejects invalid routing strategy', () => {
    const invalidStrategy: RouterConfig = {
      ...VALID_CONFIG,
      routing: { ...VALID_CONFIG.routing, strategy: 'invalid' as any },
    };

    const validation = validateEnforcement(invalidStrategy);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('routing.strategy'))).toBe(true);
  });
});

// ============================================================================
// Tests: assertEnforcement (throws on invalid)
// ============================================================================

describe('Enforcement Validator - Assertions', () => {
  it('assertEnforcement passes for valid config', () => {
    expect(() => {
      assertEnforcement(VALID_CONFIG);
    }).not.toThrow();
  });

  it('assertEnforcement throws for invalid enforcement.mode', () => {
    const badConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    expect(() => {
      assertEnforcement(badConfig);
    }).toThrow('Configuration invalid for 100% delegation');
  });

  it('assertEnforcement throws for trivialDirectAllowed=true', () => {
    const badConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    expect(() => {
      assertEnforcement(badConfig);
    }).toThrow('Configuration invalid for 100% delegation');
  });
});

// ============================================================================
// Tests: Report Generation
// ============================================================================

describe('Enforcement Validator - Reporting', () => {
  it('generates valid report for good config', () => {
    const report = reportEnforcement(VALID_CONFIG);

    expect(report).toContain('ENFORCEMENT VALIDATION REPORT');
    expect(report).toContain('✅ VALID');
    expect(report).toContain('100% delegation');
  });

  it('includes enforcement settings in report', () => {
    const report = reportEnforcement(VALID_CONFIG);

    expect(report).toContain('enforcement.mode: hard-block');
    expect(report).toContain('enforcement.trivialDirectAllowed: false');
  });

  it('includes tier models in report', () => {
    const report = reportEnforcement(VALID_CONFIG);

    expect(report).toContain('@fast');
    expect(report).toContain('@medium');
    expect(report).toContain('@heavy');
    expect(report).toContain('github-copilot/claude-haiku-4.5');
  });

  it('lists errors for invalid config', () => {
    const badConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'advisory', trivialDirectAllowed: true },
    };

    const report = reportEnforcement(badConfig);

    expect(report).toContain('❌ INVALID');
    expect(report).toContain('ERRORS');
  });
});

// ============================================================================
// Integration: Real-World Scenarios
// ============================================================================

describe('Enforcement Validator - Real-World Scenarios', () => {
  it('guarantees HARD-BLOCK mode for production', () => {
    // Production config must have hard-block + no bypass
    const prodConfig = VALID_CONFIG;

    expect(prodConfig.enforcement.mode).toBe('hard-block');
    expect(prodConfig.enforcement.trivialDirectAllowed).toBe(false);

    const validation = validateEnforcement(prodConfig);
    expect(validation.isValid).toBe(true);
  });

  it('prevents advisory mode (too permissive)', () => {
    // Someone tries to switch to advisory
    const advisoryConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    const validation = validateEnforcement(advisoryConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('CRITICAL'))).toBe(true);
  });

  it('prevents trivial bypass (defeats purpose)', () => {
    // Someone tries to allow trivial tasks to run directly
    const bypassConfig: RouterConfig = {
      ...VALID_CONFIG,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    const validation = validateEnforcement(bypassConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('trivialDirectAllowed'))).toBe(true);
  });

  it('ensures all tiers are available for routing', () => {
    // Every tier must be configured for proper delegation
    const tiers = ['fast', 'medium', 'heavy'] as const;

    for (const tier of tiers) {
      expect(VALID_CONFIG.tiers[tier]).toBeDefined();
      expect(VALID_CONFIG.tiers[tier]?.model).toBeTruthy();
      expect(VALID_CONFIG.tiers[tier]?.costRatio).toBeGreaterThan(0);
    }
  });
});
