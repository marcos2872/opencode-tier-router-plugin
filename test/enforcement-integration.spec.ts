import { describe, expect, it } from 'vitest';
import { assertEnforcement, reportEnforcement, type RouterConfig } from '../src/router/enforcement-validator.js';

const ROUTING_CONFIG = {
  strategy: 'keyword' as const,
  selectorModel: 'github-copilot/claude-haiku-4.5',
  selectorTimeoutMs: 1200,
  selectorMaxTokens: 16,
};

describe('integracao de aplicacao - inicializacao', () => {
  it('rejeita config com modo advisory', () => {
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

    expect(() => assertEnforcement(badConfig)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });

  it('rejeita config com trivialDirectAllowed=true', () => {
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

    expect(() => assertEnforcement(badConfig)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });

  it('aceita config hard-block valida', () => {
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

    expect(() => assertEnforcement(goodConfig)).not.toThrow();
  });

  it('gera relatorio de auditoria para config invalida', () => {
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
    expect(report).toContain('Invalid model');
    expect(report).toContain('@medium: invalid (5x)');
  });

  it('registra validacao de aplicacao com relatorio valido', () => {
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

describe('integracao de aplicacao - validacao de runtime', () => {
  it('garante modo hard-block nao negociavel', () => {
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

    expect(() => assertEnforcement(productionConfig)).not.toThrow();
  });

  it('rejeita qualquer bypass de aplicacao de tiers', () => {
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
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
      routing: ROUTING_CONFIG,
    };

    expect(() => assertEnforcement(bypassConfig)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });

  it('garante modelos validos para todos os tiers', () => {
    const missingModel: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
        medium: { model: '', costRatio: 5, cap: 12 },
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

    expect(() => assertEnforcement(missingModel)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });
});

describe('integracao de aplicacao - trilha de auditoria', () => {
  it('produz relatorio de auditoria detalhado', () => {
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

    expect(report).toContain('ENFORCEMENT VALIDATION REPORT');
    expect(report).toContain('✅ VALID');
    expect(report).toContain('enforcement.mode: hard-block');
    expect(report).toContain('enforcement.trivialDirectAllowed: false');
    expect(report).toContain('@fast');
    expect(report).toContain('@medium');
    expect(report).toContain('@heavy');
    expect(report).toContain('100% delegation');
  });

  it('inclui todos os erros no relatorio quando config e invalida', () => {
    const badConfig: RouterConfig = {
      mode: 'normal',
      tiers: {
        fast: { model: 'invalid', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
      },
      modes: { normal: { defaultTier: 'medium' } },
      taskPatterns: { fast: ['find'], medium: ['implement'], heavy: ['design'] },
      enforcement: { mode: 'advisory', trivialDirectAllowed: true },
      routing: ROUTING_CONFIG,
    };

    const report = reportEnforcement(badConfig);

    expect(report).toContain('❌ INVALID');
    expect(report).toContain('ERRORS');
    expect(report).toContain('enforcement.mode is "advisory"');
    expect(report).toContain('enforcement.trivialDirectAllowed is true');
    expect(report).toContain('Invalid model for @fast');
  });
});
