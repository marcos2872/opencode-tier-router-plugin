import type { RouterConfig, TaskPatterns } from './config.js';
import { classifyTask as classifyTaskFromPatterns } from './classifier.js';

/**
 * Monta o protocolo de delegação de tarefas em formato Markdown.
 *
 * @param cfg - Configuração do roteador usada para gerar os tiers, regras e instruções de enforcement.
 * @returns Protocolo de delegação que pode ser injetado no sistema do modelo.
 */
export function buildDelegationProtocol(cfg: RouterConfig): string {
  const activeMode = cfg.modes[cfg.mode];
  const defaultTier = activeMode?.defaultTier ?? 'medium';

  const tiersLine = Object.entries(cfg.tiers)
    .map(([name, tier]) => `@${name}=${tier.model}(${tier.costRatio}x)`)
    .join(' ');

  const rulesLine = Object.entries(cfg.taskPatterns)
    .map(([tier, patterns]) => `@${tier}→${patterns.join('/')}`)
    .join(' ');

  const modeEmphasis: Record<string, string> = {
    normal: 'balanced — use cheapest matching tier, fallback to default',
    budget: 'cost-first — prefer @fast unless heavy keywords dominate',
    quality: 'quality-first — prefer @medium/@heavy over @fast',
    deep: 'depth-first — route architecture/debug to @heavy, default @heavy',
  };

  const emphasis = modeEmphasis[cfg.mode] ?? `mode ${cfg.mode}, default @${defaultTier}`;
  const hardBlockOn = cfg.enforcement.mode === 'hard-block';
  const trivialRule = cfg.enforcement.trivialDirectAllowed
    ? 'Trivial requests may execute directly.'
    : 'Trivial requests MUST also delegate.';
  const enforcementRule = hardBlockOn
    ? 'Enforcement: HARD-BLOCK enabled. Non-trivial requests MUST delegate to @fast/@medium/@heavy; direct execution is not allowed.'
    : 'Enforcement: advisory-only. Prefer delegation; direct execution is allowed when needed.';

  return [
    '## Model Delegation Protocol',
    `Tiers: ${tiersLine} mode:${cfg.mode}`,
    `Default: @${defaultTier}`,
    `Routing: strategy=${cfg.routing.strategy} selector=${cfg.routing.selectorModel}`,
    `R: ${rulesLine}`,
    `Mode: ${cfg.mode} (${emphasis})`,
    'Rule: Classify user intent by keywords. For non-trivial requests, delegate to the cheapest matching tier. If no tier matches, use the default.',
    `Rule: ${trivialRule}`,
    `Rule: ${enforcementRule}`,
    'Rule: Respect [cap:N/MAX], [⚠ CAP WARNING], [⚠ CAP REACHED], and [⚠ REDUNDANT] banners; they signal read-limit fatigue and repeated work.',
    'Cost signal: @fast≈1x, @medium≈5x, @heavy≈20x. Minimize cost while preserving task adequacy.',
  ].join('\n');
}

/**
 * Classifica uma solicitação de usuário em um tier com base nos padrões de tarefa configurados.
 *
 * @param text - Texto da solicitação a ser classificado.
 * @param taskPatterns - Mapeamento de palavras-chave para os tiers `fast`, `medium` e `heavy`.
 * @returns O tier correspondente ou `null` quando nenhuma regra combinar.
 */
export function classifyTask(text: string, taskPatterns: TaskPatterns): 'fast' | 'medium' | 'heavy' | null {
  return classifyTaskFromPatterns(text, taskPatterns);
}
