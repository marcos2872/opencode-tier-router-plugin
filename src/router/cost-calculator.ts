import type { TokenRecord } from './token-event-parser.js';
import type { TierConfig } from './config.js';

/**
 * Calculate token cost based on tier's cost ratio.
 * Formula: (inputTokens + outputTokens) * tier.costRatio / 1000
 */
export function calculateCost(
  tokens: { input?: number; output?: number },
  tier: { costRatio: number }
): number {
  const total = (tokens.input ?? 0) + (tokens.output ?? 0);
  return (total * tier.costRatio) / 1000;
}
