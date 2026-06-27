import type { RouterConfig, TaskPatterns } from './config.js';

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

  return [
    '## Model Delegation Protocol',
    `Tiers: ${tiersLine} mode:${cfg.mode}`,
    `Default: @${defaultTier}`,
    `R: ${rulesLine}`,
    `Mode: ${cfg.mode} (${emphasis})`,
    'Rule: Classify user intent by keywords. For trivial requests (≤1 read/grep/list, no follow-up) execute directly. Otherwise delegate to the cheapest matching tier. If no tier matches, use the default.',
    'Rule: Respect [cap:N/MAX], [⚠ CAP WARNING], [⚠ CAP REACHED], and [⚠ REDUNDANT] banners; they signal read-limit fatigue and repeated work.',
    'Cost signal: @fast≈1x, @medium≈5x, @heavy≈20x. Minimize cost while preserving task adequacy. Never hard-block; advisory only.',
  ].join('\n');
}

export function classifyTask(text: string, taskPatterns: TaskPatterns): 'fast' | 'medium' | 'heavy' | null {
  const lower = text.toLowerCase();
  const tiers: Array<'fast' | 'medium' | 'heavy'> = ['fast', 'medium', 'heavy'];

  for (const tier of tiers) {
    const patterns = taskPatterns[tier];
    if (!patterns) continue;
    for (const pattern of patterns) {
      if (matchesWordStart(lower, pattern)) {
        return tier;
      }
    }
  }

  return null;
}

function matchesWordStart(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}`, 'i');
  return regex.test(text);
}
