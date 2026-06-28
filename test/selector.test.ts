import { describe, expect, it, vi } from 'vitest';
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
  it('classifica com estratégia keyword', async () => {
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

  it('combina verbos portugueses conjugados pelo léxico', async () => {
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

  it('usa estratégia llm quando o selector retorna um tier válido', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };
    const prompt = vi.fn().mockResolvedValue('fast');
    const client = {
      session: {
        prompt,
      },
    };

    await expect(selectTierByStrategy('any text', llmCfg, client)).resolves.toEqual({
      tier: 'fast',
      source: 'llm',
    });
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: cfg.routing.selectorModel,
          parts: [expect.objectContaining({ text: expect.stringContaining('Classify the user request') })],
        }),
      }),
    );
  });

  it('faz fallback para keyword quando o selector llm falha', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };
    const prompt = vi.fn().mockRejectedValue(new Error('selector failed'));
    const client = {
      session: {
        prompt,
      },
    };

    await expect(selectTierByStrategy('find auth files', llmCfg, client)).resolves.toEqual({
      tier: 'fast',
      source: 'fallback-keyword',
    });
    expect(prompt).toHaveBeenCalled();
  });

  it('faz fallback para keyword quando o selector llm não retorna tier', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };
    const prompt = vi.fn().mockResolvedValue('slow');
    const client = {
      session: {
        prompt,
      },
    };

    await expect(selectTierByStrategy('find auth files', llmCfg, client)).resolves.toEqual({
      tier: 'fast',
      source: 'fallback-keyword',
    });
  });

  it('usa fallback-default quando nenhuma estratégia encontra tier', async () => {
    await expect(selectTierByStrategy('plain maintenance', cfg)).resolves.toEqual({
      tier: 'medium',
      source: 'fallback-default',
    });
  });

  it('usa fallback-default quando strategy llm não encontra tier', async () => {
    const llmCfg: RouterConfig = {
      ...cfg,
      routing: {
        ...cfg.routing,
        strategy: 'llm',
      },
    };
    const prompt = vi.fn().mockResolvedValue('slow');
    const client = {
      session: {
        prompt,
      },
    };

    await expect(selectTierByStrategy('plain maintenance', llmCfg, client)).resolves.toEqual({
      tier: 'medium',
      source: 'fallback-default',
    });
  });
});
