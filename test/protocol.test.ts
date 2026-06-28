import { describe, it, expect } from 'vitest';
import { buildDelegationProtocol, classifyTask } from '../src/router/protocol.js';
import type { RouterConfig } from '../src/router/config.js';

const validConfig: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'openai/gpt-4.1-nano', costRatio: 1, cap: 8 },
    medium: { model: 'anthropic/claude-sonnet-4-5', costRatio: 5, cap: 12 },
    heavy: { model: 'anthropic/claude-opus-4', costRatio: 20, cap: 20 },
  },
  modes: {
    normal: { description: 'Balanced', defaultTier: 'medium' },
    budget: { description: 'Cheap', defaultTier: 'fast' },
    quality: { description: 'Better', defaultTier: 'medium' },
    deep: { description: 'Deep', defaultTier: 'heavy' },
  },
  taskPatterns: {
    fast: ['find', 'grep', 'search'],
    medium: ['refactor', 'implement', 'fix'],
    heavy: ['design', 'architecture', 'debug'],
  },
  enforcement: {
    mode: 'advisory',
    trivialDirectAllowed: true,
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

describe('buildDelegationProtocol', () => {
  it('returns a protocol string starting with the header', () => {
    const protocol = buildDelegationProtocol(validConfig);
    expect(protocol.startsWith('=== MANDATORY DELEGATION PROTOCOL ===')).toBe(true);
  });

  it('includes tier models and cost ratios', () => {
    const protocol = buildDelegationProtocol(validConfig);
    expect(protocol).toContain('@fast=openai/gpt-4.1-nano(1x)');
    expect(protocol).toContain('@medium=anthropic/claude-sonnet-4-5(5x)');
    expect(protocol).toContain('@heavy=anthropic/claude-opus-4(20x)');
  });

  it('includes the current mode', () => {
    const protocol = buildDelegationProtocol(validConfig);
    expect(protocol).toContain('mode:normal');
  });

  it('includes task patterns for each tier', () => {
    const protocol = buildDelegationProtocol(validConfig);
    expect(protocol).toContain('@fast→find/grep/search');
    expect(protocol).toContain('@medium→refactor/implement/fix');
    expect(protocol).toContain('@heavy→design/architecture/debug');
  });

  it('produces different protocol strings for different modes', () => {
    const normal = buildDelegationProtocol({ ...validConfig, mode: 'normal' });
    const budget = buildDelegationProtocol({ ...validConfig, mode: 'budget' });
    const quality = buildDelegationProtocol({ ...validConfig, mode: 'quality' });
    const deep = buildDelegationProtocol({ ...validConfig, mode: 'deep' });

    expect(normal).not.toBe(budget);
    expect(budget).not.toBe(quality);
    expect(quality).not.toBe(deep);
  });

  it('emphasizes the default tier for the current mode', () => {
    expect(buildDelegationProtocol({ ...validConfig, mode: 'normal' })).toContain('Default: @medium');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'budget' })).toContain('Default: @fast');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'quality' })).toContain('Default: @medium');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'deep' })).toContain('Default: @heavy');
  });

  it('includes mode-specific routing guidance', () => {
    expect(buildDelegationProtocol({ ...validConfig, mode: 'budget' })).toContain('cost-first');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'quality' })).toContain('quality-first');
    expect(buildDelegationProtocol({ ...validConfig, mode: 'deep' })).toContain('depth-first');
  });

  it('includes the trivial direct-execution rule', () => {
    const protocol = buildDelegationProtocol(validConfig);
    expect(protocol).toContain('Trivial requests may execute directly.');
    expect(protocol).toContain('advisory-only');
  });

  it('includes hard-block rule when enforcement mode is hard-block', () => {
    const protocol = buildDelegationProtocol({
      ...validConfig,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    });

    expect(protocol).toContain('HARD-BLOCK enabled');
    expect(protocol).toContain('MUST delegate');
  });
});

describe('classifyTask', () => {
  it('returns fast for fast keywords', () => {
    expect(classifyTask('find the auth function', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('grep for TODOs', validConfig.taskPatterns)).toBe('fast');
  });

  it('returns medium for medium keywords', () => {
    expect(classifyTask('refactor this function', validConfig.taskPatterns)).toBe('medium');
    expect(classifyTask('implement login', validConfig.taskPatterns)).toBe('medium');
  });

  it('returns heavy for heavy keywords', () => {
    expect(classifyTask('design the auth module', validConfig.taskPatterns)).toBe('heavy');
    expect(classifyTask('debug the failure', validConfig.taskPatterns)).toBe('heavy');
  });

  it('is case-insensitive', () => {
    expect(classifyTask('FIND something', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('DEBUG issue', validConfig.taskPatterns)).toBe('heavy');
  });

  it('matches word stems at boundaries', () => {
    expect(classifyTask('finding files', validConfig.taskPatterns)).toBe('fast');
    expect(classifyTask('debugging the code', validConfig.taskPatterns)).toBe('heavy');
  });

  it('does not match mid-word occurrences', () => {
    expect(classifyTask('research paper', validConfig.taskPatterns)).toBeNull();
    expect(classifyTask('undefined behavior', validConfig.taskPatterns)).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(classifyTask('hello world', validConfig.taskPatterns)).toBeNull();
  });
});
