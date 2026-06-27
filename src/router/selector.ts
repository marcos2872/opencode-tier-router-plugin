import type { RouterConfig } from './config.js';
import { classifyTask as classifyByPattern } from './classifier.js';
import { buildSelectorPrompt } from '../prompts.js';

/**
 * Representa um dos tiers de complexidade usados pelo roteador.
 */
export type TierName = 'fast' | 'medium' | 'heavy';

/**
 * Indica a origem da seleção de tier feita pelo seletor.
 */
export type SelectionSource = 'llm' | 'keyword' | 'fallback-keyword' | 'fallback-default';

/**
 * Resultado da seleção de tier para uma solicitação.
 *
 * @property tier - Tier escolhido: `fast`, `medium` ou `heavy`.
 * @property source - Origem da seleção: `llm`, `keyword`, `fallback-keyword` ou `fallback-default`.
 */
export interface TierSelection {
  tier: TierName;
  source: SelectionSource;
}

const FAST_STEMS = [
  'find',
  'grep',
  'search',
  'locat',
  'list',
  'show',
  'read',
  'explor',
  'lookup',
  'inspect',
  'scan',
  'query',
  'busc',
  'procur',
  'list',
  'mostr',
  'ler',
  'leitur',
  'mape',
  'catalog',
  'inventari',
  'rastre',
  'localiz',
  'pesquis',
  'consult',
  'descobr',
];

const MEDIUM_STEMS = [
  'implement',
  'refactor',
  'add',
  'write',
  'fix',
  'update',
  'change',
  'create',
  'edit',
  'rename',
  'build',
  'ship',
  'patch',
  'cod',
  'integrat',
  'adapt',
  'improv',
  'ajust',
  'implem',
  'refator',
  'adicion',
  'corrig',
  'atualiz',
  'cri',
  'edit',
  'renome',
  'valid',
  'desenvolv',
  'escrev',
  'mont',
  'constru',
];

const HEAVY_STEMS = [
  'design',
  'architect',
  'debug',
  'complex',
  'explain',
  'reason',
  'analy',
  'optim',
  'quality',
  'review',
  'strategy',
  'root cause',
  'deep dive',
  'diagnos',
  'investig',
  'model',
  'tradeoff',
  'arquitet',
  'depur',
  'complex',
  'analis',
  'otimiz',
  'qualidad',
  'revis',
  'diagnostic',
  'estrateg',
  'causa raiz',
  'investig',
  'raciocin',
  'explic',
];

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countStemMatches(text: string, stems: string[]): number {
  let score = 0;
  for (const stem of stems) {
    if (text.includes(stem)) score += 1;
  }
  return score;
}

function classifyByLexicon(text: string): TierName | null {
  const normalized = normalize(text);
  if (!normalized) return null;

  const heavy = countStemMatches(normalized, HEAVY_STEMS);
  const medium = countStemMatches(normalized, MEDIUM_STEMS);
  const fast = countStemMatches(normalized, FAST_STEMS);

  if (heavy === 0 && medium === 0 && fast === 0) return null;
  if (heavy >= medium && heavy >= fast) return 'heavy';
  if (medium >= fast) return 'medium';
  return 'fast';
}

interface OpenCodeClientLike {
  session: {
    prompt: (...args: unknown[]) => Promise<unknown>;
  };
}

/**
 * Guarda de tipo para validar que um valor desconhecido é um cliente OpenCode
 * com função session.prompt.
 */
function isOpenCodeClient(client: unknown): client is OpenCodeClientLike {
  return (
    client !== null &&
    typeof client === 'object' &&
    'session' in client &&
    client.session !== null &&
    typeof client.session === 'object' &&
    'prompt' in client.session &&
    typeof (client.session as Record<string, unknown>).prompt === 'function'
  );
}

async function classifyByLLM(text: string, cfg: RouterConfig, client: unknown): Promise<TierName | null> {
  if (!isOpenCodeClient(client)) return null;

  const api = client;

  if (!api.session.prompt) return null;

  const model = cfg.routing.selectorModel;
  const timeoutMs = cfg.routing.selectorTimeoutMs;

  const selectorPrompt = buildSelectorPrompt(text);

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const requestPromise = api.session
    .prompt({
      body: {
        model,
        noReply: false,
        parts: [{ type: 'text', text: selectorPrompt }],
      },
    })
    .then((response: unknown) => {
      const raw = JSON.stringify(response).toLowerCase();
      if (raw.includes('"fast"') || raw.includes(' fast ')) return 'fast' as const;
      if (raw.includes('"medium"') || raw.includes(' medium ')) return 'medium' as const;
      if (raw.includes('"heavy"') || raw.includes(' heavy ')) return 'heavy' as const;
      return null;
    })
    .catch(() => null);

  return Promise.race([requestPromise, timeoutPromise]);
}

/**
 * Seleciona o tier mais adequado para uma solicitação usando a estratégia configurada.
 *
 * @param text - Texto da solicitação a ser classificada.
 * @param cfg - Configuração do roteador com estratégia, fallback e padrões de tarefa.
 * @param client - Cliente OpenCode opcional usado quando a estratégia é `llm`.
 * @returns Seleção do tier escolhido e sua origem.
 */
export async function selectTierByStrategy(text: string, cfg: RouterConfig, client?: unknown): Promise<TierSelection> {
  if (cfg.routing.strategy === 'llm') {
    const llmTier = await classifyByLLM(text, cfg, client);
    if (llmTier) {
      return { tier: llmTier, source: 'llm' };
    }

    const keywordTier = classifyByPattern(text, cfg.taskPatterns) ?? classifyByLexicon(text);
    if (keywordTier) {
      return { tier: keywordTier, source: 'fallback-keyword' };
    }

    const fallback = cfg.modes[cfg.mode]?.defaultTier;
    const tier: TierName = fallback === 'fast' || fallback === 'medium' || fallback === 'heavy' ? fallback : 'medium';
    return { tier, source: 'fallback-default' };
  }

  const keywordTier = classifyByPattern(text, cfg.taskPatterns) ?? classifyByLexicon(text);
  if (keywordTier) {
    return { tier: keywordTier, source: 'keyword' };
  }

  const fallback = cfg.modes[cfg.mode]?.defaultTier;
  const tier: TierName = fallback === 'fast' || fallback === 'medium' || fallback === 'heavy' ? fallback : 'medium';
  return { tier, source: 'fallback-default' };
}
