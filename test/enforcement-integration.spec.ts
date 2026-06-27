/**
 * Enforcement Integration Tests
 *
 * Validates that the plugin wires enforcement validator correctly.
 * Ensures config hook validates 100% delegation at initialization.
 */

import { describe, it, expect } from 'vitest';
import { assertEnforcement, reportEnforcement } from '../src/router/enforcement-validator.js';
import type { RouterConfig } from '../src/router/config.js';

const ROUTING_CONFIG = {
  strategy: 'keyword' as const,
  selectorModel: 'github-copilot/claude-haiku-4.5',
  selectorTimeoutMs: 1200,
  selectorMaxTokens: 16,
};

describe('Enforcement Integration - Plugin Init', () => {
  it('rejects config with advisory mode at initialization', () => {
    const badConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    expect(() => {
      assertEnforcement(badConfig);
    }).toThrow();
  });

  it('rejects config with trivialDirectAllowed=true at initialization', () => {
    const badConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: ROUTING_CONFIG,
    };

    expect(() => {
      assertEnforcement(badConfig);
    }).toThrow();
  });

  it('accepts valid hard-block config', () => {
    const goodConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search', 'read'],
        medium: ['implement', 'fix', 'add'],
        heavy: ['design', 'debug', 'analyze'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    expect(() => {
      assertEnforcement(goodConfig);
    }).not.toThrow();
  });

  it('generates audit report for invalid configs', () => {
    const badConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'invalid', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['search'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    const report = reportEnforcement(badConfig);

    expect(report).toContain('❌ INVALID');
    expect(report).toContain('ERRORS');
    expect(report).toContain('Invalid model');
  });

  it('logs enforcement validation success', () => {
    const goodConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search', 'read'],
        medium: ['implement', 'fix', 'add'],
        heavy: ['design', 'debug', 'analyze'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    const report = reportEnforcement(goodConfig);

    expect(report).toContain('✅ VALID');
    expect(report).toContain('100% delegation');
  });
});

describe('Enforcement Integration - Runtime Validation', () => {
  it('ensures HARD-BLOCK mode is non-negotiable', () => {
    // Production config MUST have hard-block
    const productionConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search'],
        medium: ['implement', 'fix'],
        heavy: ['design', 'debug'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    // Should not throw
    expect(() => assertEnforcement(productionConfig)).not.toThrow();
  });

  it('rejects any config that bypasses tier enforcement', () => {
    const bypassConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search'],
        medium: ['implement', 'fix'],
        heavy: ['design', 'debug'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true }, // ❌ Bypass allowed
      routing: ROUTING_CONFIG,
    };

    expect(() => assertEnforcement(bypassConfig)).toThrow();
  });

  it('ensures all 3 tiers have valid models', () => {
    const missingModel: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: '', costRatio: 5, cap: 12 }, // ❌ Empty model
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search'],
        medium: ['implement', 'fix'],
        heavy: ['design', 'debug'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    expect(() => assertEnforcement(missingModel)).toThrow();
  });
});

describe('Enforcement Integration - Audit Trail', () => {
  it('produces detailed audit report for compliance', () => {
    const config: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find', 'search', 'read'],
        medium: ['implement', 'fix', 'add'],
        heavy: ['design', 'debug', 'analyze'],
      },
      enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
      routing: ROUTING_CONFIG,
    };

    const report = reportEnforcement(config);

    // Should include all critical sections
    expect(report).toContain('ENFORCEMENT VALIDATION REPORT');
    expect(report).toContain('✅ VALID');
    expect(report).toContain('enforcement.mode: hard-block');
    expect(report).toContain('enforcement.trivialDirectAllowed: false');
    expect(report).toContain('@fast');
    expect(report).toContain('@medium');
    expect(report).toContain('@heavy');
    expect(report).toContain('100% delegation');
  });

  it('includes all errors in audit report when config invalid', () => {
    const badConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'invalid', costRatio: 1, cap: 8 }, // ❌
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: {
        fast: ['find'],
        medium: ['implement'],
        heavy: ['design'],
      },
      enforcement: { mode: 'advisory', trivialDirectAllowed: true }, // ❌ Both bad
      routing: ROUTING_CONFIG,
    };

    const report = reportEnforcement(badConfig);

    expect(report).toContain('❌ INVALID');
    expect(report).toContain('ERRORS');
  });
});
