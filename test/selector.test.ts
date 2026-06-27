import { describe, it, expect } from 'vitest';
import { selectTierByStrategy } from '../src/router/selector.js';
import type { RouterConfig } from '../src/router/config.js';

const cfg: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
    medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
    heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
  },
  modes: {
    normal: { defaultTier: 'medium' },
    budget: { defaultTier: 'fast' },
    quality: { defaultTier: 'medium' },
    deep: { defaultTier: 'heavy' },
  },
  taskPatterns: {
    fast: ['find', 'grep', 'search', 'buscar', 'busque', 'procurar', 'procure', 'ler', 'leia'],
    medium: ['implement', 'refactor', 'fix', 'implementar', 'refatorar', 'corrigir'],
    heavy: ['design', 'debug', 'analyze', 'arquitetura', 'depurar', 'analisar'],
  },
  enforcement: {
    mode: 'hard-block',
    trivialDirectAllowed: true,
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

describe('selectTierByStrategy', () => {
  it('classifies with keyword strategy', async () => {
    await expect(selectTierByStrategy('find auth files', cfg)).resolves.toEqual({
      tier: 'fast',
      source: 'keyword',
    });

    await expect(selectTierByStrategy('implementar login', cfg)).resolves.toEqual({
      tier: 'medium',
      source: 'keyword',
    });

    await expect(selectTierByStrategy('debug authentication flow', cfg)).resolves.toEqual({
      tier: 'heavy',
      source: 'keyword',
    });
  });

  it('matches conjugated portuguese verbs via lexicon stems', async () => {
    await expect(selectTierByStrategy('procure sobre autenticacao no projeto', cfg)).resolves.toEqual({
      tier: 'fast',
      source: 'keyword',
    });

    await expect(selectTierByStrategy('busque o fluxo de token', cfg)).resolves.toEqual({
      tier: 'fast',
      source: 'keyword',
    });

    await expect(selectTierByStrategy('corrigindo o handler de login', cfg)).resolves.toEqual({
      tier: 'medium',
      source: 'keyword',
    });
  });

  it('uses llm strategy when selector returns a valid tier', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };

    const client = {
      session: {
        prompt: async () => ({ tier: 'fast' }),
      },
    };

    await expect(selectTierByStrategy('any text', llmCfg, client)).resolves.toEqual({
      tier: 'fast',
      source: 'llm',
    });
  });

  it('falls back from llm to keyword', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };

    const client = {
      session: {
        prompt: async () => {
          throw new Error('selector failed');
        },
      },
    };

    await expect(selectTierByStrategy('find auth files', llmCfg, client)).resolves.toEqual({
      tier: 'fast',
      source: 'fallback-keyword',
    });
  });
});
