import { describe, expect, it } from 'vitest';
import { assertEnforcement, reportEnforcement, validateEnforcement, type RouterConfig } from '../src/router/enforcement-validator.js';

const validConfig: RouterConfig = {
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
    trivialDirectAllowed: false,
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

describe('validar aplicacao', () => {
  it('aceita config de delegacao 100%', () => {
    const validation = validateEnforcement(validConfig);

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.warnings).toHaveLength(0);
    expect(validation.recommendations).toHaveLength(0);
  });

  it('rejeita modo advisory', () => {
    const badConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    const validation = validateEnforcement(badConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual([
      '❌ CRITICAL: enforcement.mode is "advisory" but MUST be "hard-block". Advisory mode allows tasks to bypass delegation!',
    ]);
  });

  it('rejeita trivialDirectAllowed=true', () => {
    const badConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    const validation = validateEnforcement(badConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual([
      '❌ CRITICAL: enforcement.trivialDirectAllowed is true but MUST be false. This allows "trivial" tasks to execute directly in main window!',
    ]);
  });

  it('verifica hierarquia de custo fast < medium < heavy', () => {
    const fastTooExpensive: RouterConfig = {
      ...validConfig,
      tiers: {
        ...validConfig.tiers,
        fast: { ...validConfig.tiers.fast, costRatio: 5 },
      },
    };
    const mediumTooExpensive: RouterConfig = {
      ...validConfig,
      tiers: {
        ...validConfig.tiers,
        medium: { ...validConfig.tiers.medium, costRatio: 20 },
      },
    };

    expect(validateEnforcement(fastTooExpensive).errors).toContain(
      '❌ Cost hierarchy violated: @fast (5x) should be < @medium (5x)',
    );
    expect(validateEnforcement(mediumTooExpensive).errors).toContain(
      '❌ Cost hierarchy violated: @medium (20x) should be < @heavy (20x)',
    );
  });
});

describe('configuracao de tiers', () => {
  it('exige fast, medium e heavy', () => {
    const missingTier = {
      ...validConfig,
      tiers: {
        fast: validConfig.tiers.fast,
        medium: validConfig.tiers.medium,
      },
    } as unknown as RouterConfig;

    const validation = validateEnforcement(missingTier);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('❌ Missing tier: @heavy is required');
  });

  it('exige modelo provider/model por tier', () => {
    const invalidModel: RouterConfig = {
      ...validConfig,
      tiers: {
        ...validConfig.tiers,
        fast: { ...validConfig.tiers.fast, model: 'invalid-model' },
      },
    };

    const validation = validateEnforcement(invalidModel);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(
      '❌ Invalid model for @fast: "invalid-model" doesn\'t match "provider/model" format',
    );
  });

  it('exige costRatio positivo por tier', () => {
    const zeroCost: RouterConfig = {
      ...validConfig,
      tiers: {
        ...validConfig.tiers,
        fast: { ...validConfig.tiers.fast, costRatio: 0 },
      },
    };

    const validation = validateEnforcement(zeroCost);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('❌ Invalid costRatio for @fast: must be positive number');
  });

  it('exige cap positivo por tier', () => {
    const zeroCap: RouterConfig = {
      ...validConfig,
      tiers: {
        ...validConfig.tiers,
        medium: { ...validConfig.tiers.medium, cap: 0 },
      },
    };

    const validation = validateEnforcement(zeroCap);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('❌ Invalid cap for @medium: must be positive number');
  });
});

describe('cobertura de padrões de tarefa', () => {
  it('avisa quando fast tem poucos padrões', () => {
    const sparsePatterns: RouterConfig = {
      ...validConfig,
      taskPatterns: {
        ...validConfig.taskPatterns,
        fast: ['search'],
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.isValid).toBe(true);
    expect(validation.warnings).toContain('⚠️  Too few fast patterns (1): may not catch search tasks');
  });

  it('avisa quando medium tem poucos padrões', () => {
    const sparsePatterns: RouterConfig = {
      ...validConfig,
      taskPatterns: {
        ...validConfig.taskPatterns,
        medium: ['implement', 'fix'],
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.isValid).toBe(true);
    expect(validation.warnings).toContain('⚠️  Too few medium patterns (2): may not catch implementation tasks');
  });

  it('avisa quando heavy tem poucos padrões', () => {
    const sparsePatterns: RouterConfig = {
      ...validConfig,
      taskPatterns: {
        ...validConfig.taskPatterns,
        heavy: ['design', 'debug'],
      },
    };

    const validation = validateEnforcement(sparsePatterns);

    expect(validation.isValid).toBe(true);
    expect(validation.warnings).toContain('⚠️  Too few heavy patterns (2): may not catch architecture/design tasks');
  });
});

describe('estrategia de roteamento', () => {
  it('aceita keyword', () => {
    const validation = validateEnforcement(validConfig);

    expect(validation.isValid).toBe(true);
  });

  it('aceita llm', () => {
    const llmConfig: RouterConfig = {
      ...validConfig,
      routing: { ...validConfig.routing, strategy: 'llm' },
    };

    const validation = validateEnforcement(llmConfig);

    expect(validation.isValid).toBe(true);
  });

  it('rejeita estrategia invalida', () => {
    const invalidStrategy: RouterConfig = {
      ...validConfig,
      routing: { ...validConfig.routing, strategy: 'invalid' as RouterConfig['routing']['strategy'] },
    };

    const validation = validateEnforcement(invalidStrategy);

    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('❌ Invalid routing.strategy: "invalid" (must be "keyword" or "llm")');
  });
});

describe('assertEnforcement', () => {
  it('aceita config valida', () => {
    expect(() => assertEnforcement(validConfig)).not.toThrow();
  });

  it('lança erro para enforcement.mode invalido', () => {
    const badConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    expect(() => assertEnforcement(badConfig)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });

  it('lança erro para trivialDirectAllowed=true', () => {
    const badConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    expect(() => assertEnforcement(badConfig)).toThrow(
      '[Enforcement] Configuration invalid for 100% delegation:',
    );
  });
});

describe('geracao de relatorios', () => {
  it('gera relatorio para config valida', () => {
    const report = reportEnforcement(validConfig);

    expect(report).toContain('ENFORCEMENT VALIDATION REPORT');
    expect(report).toContain('✅ VALID');
    expect(report).toContain('100% delegation');
  });

  it('inclui configuracao de aplicacao no relatorio', () => {
    const report = reportEnforcement(validConfig);

    expect(report).toContain('enforcement.mode: hard-block');
    expect(report).toContain('enforcement.trivialDirectAllowed: false');
  });

  it('inclui modelos de tiers no relatorio', () => {
    const report = reportEnforcement(validConfig);

    expect(report).toContain('@fast');
    expect(report).toContain('@medium');
    expect(report).toContain('@heavy');
    expect(report).toContain('github-copilot/claude-haiku-4.5');
  });

  it('lista erros para config invalida', () => {
    const badConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'advisory', trivialDirectAllowed: true },
    };

    const report = reportEnforcement(badConfig);

    expect(report).toContain('❌ INVALID');
    expect(report).toContain('ERRORS');
  });
});

describe('cenarios reais de aplicacao', () => {
  it('garante modo hard-block em producao', () => {
    const prodConfig = validConfig;

    expect(prodConfig.enforcement.mode).toBe('hard-block');
    expect(prodConfig.enforcement.trivialDirectAllowed).toBe(false);

    const validation = validateEnforcement(prodConfig);

    expect(validation.isValid).toBe(true);
  });

  it('impede modo advisory', () => {
    const advisoryConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'advisory', trivialDirectAllowed: false },
    };

    const validation = validateEnforcement(advisoryConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('CRITICAL'))).toBe(true);
  });

  it('impede bypass trivial', () => {
    const bypassConfig: RouterConfig = {
      ...validConfig,
      enforcement: { mode: 'hard-block', trivialDirectAllowed: true },
    };

    const validation = validateEnforcement(bypassConfig);

    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('trivialDirectAllowed'))).toBe(true);
  });

  it('garante que todos os tiers estao disponiveis para roteamento', () => {
    for (const tier of ['fast', 'medium', 'heavy'] as const) {
      expect(validConfig.tiers[tier]).toBeDefined();
      expect(validConfig.tiers[tier]?.model).toBeTruthy();
      expect(validConfig.tiers[tier]?.costRatio).toBeGreaterThan(0);
    }
  });
});
