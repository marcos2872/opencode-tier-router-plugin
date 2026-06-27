/**
 * Metrics Aggregator — Domain Layer
 *
 * Responsibility: Aggregate TokenRecords into SessionTokenSummary
 * Calculate tier accuracy based on actual token usage
 * Zero I/O, pure business logic
 */

import type { TokenRecord, TokenUsage } from './token-event-parser.js';
import type { RouterConfig, TierName } from './config.js';

export type TierAccuracy = 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT' | 'UNKNOWN';

export interface AccuracyBreakdown {
  optimal: number;      // percentage
  right: number;        // percentage
  acceptable: number;   // percentage
  suboptimal: number;   // percentage
  overshot: number;     // percentage
}

export interface SessionTokenSummary {
  sessionId: string;
  records: TokenRecord[];
  startTime: number;
  endTime: number;

  // Real token aggregates
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCacheCost: number;
  totalCostReal: number;

  // Accuracy analysis
  accuracyBreakdown: AccuracyBreakdown;

  // Estimation quality
  averageInputEstimationError: number;   // percentage
  averageOutputEstimationError: number;  // percentage

  // Comparison to baselines
  costSavedVsDefault: number;    // vs medium (5x)
  costSavedVsHeavy: number;      // vs heavy (20x)
  averageActualCostRatio: number; // observed multiplier
}

/**
 * MetricsAggregator interface
 *
 * Port: abstraction for aggregation logic and accuracy calculation.
 * Allows testing with mock implementations.
 */
export interface MetricsAggregator {
  /**
   * Calculate tier accuracy based on actual token usage and delegated tier.
   * Uses thresholds from config.
   */
  calculateTierAccuracy(
    totalTokens: number,
    tier: 'fast' | 'medium' | 'heavy' | 'unknown',
    cfg: RouterConfig,
  ): TierAccuracy;

  /**
   * Aggregate all records from a session into a summary with metrics.
   */
  aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary;
}

/**
 * DefaultMetricsAggregator
 *
 * Reference implementation: standard aggregation and accuracy calculation.
 */
export class DefaultMetricsAggregator implements MetricsAggregator {
  calculateTierAccuracy(
    totalTokens: number,
    tier: 'fast' | 'medium' | 'heavy' | 'unknown',
    cfg: RouterConfig,
  ): TierAccuracy {
    // ✅ ERRO-003 CORRIGIDO: Use config thresholds instead of hardcoded
    if (tier === 'unknown') return 'UNKNOWN';

    const tierCfg = cfg.tiers[tier as TierName];
    if (!tierCfg?.thresholds) return 'UNKNOWN';

    const { min, max } = tierCfg.thresholds;

    // Determine accuracy based on where tokens fall
    if (totalTokens < min) {
      // Tokens below tier → tier was over-provisioned
      if (tier === 'fast') return 'RIGHT'; // small task on fast is correct
      return 'ACCEPTABLE'; // safe to use heavier tier for small task
    } else if (max === null || totalTokens <= max) {
      // Tokens within tier range → perfect fit
      return 'RIGHT';
    } else {
      // Tokens above tier range → tier was under-provisioned
      if (tier === 'heavy') return 'ACCEPTABLE'; // heavy can handle some overage
      return 'OVERSHOT'; // tier couldn't handle actual usage
    }
  }

  aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary {
    if (records.length === 0) {
      return {
        sessionId: 'unknown',
        records: [],
        startTime: 0,
        endTime: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        totalCacheCost: 0,
        totalCostReal: 0,
        accuracyBreakdown: {
          optimal: 0,
          right: 0,
          acceptable: 0,
          suboptimal: 0,
          overshot: 0,
        },
        averageInputEstimationError: 0,
        averageOutputEstimationError: 0,
        costSavedVsDefault: 0,
        costSavedVsHeavy: 0,
        averageActualCostRatio: 0,
      };
    }

    // Aggregate all token fields
    const totalInputTokens = records.reduce((sum, r) => sum + r.actualTokens.input, 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + r.actualTokens.output, 0);
    const totalReasoningTokens = records.reduce((sum, r) => sum + r.actualTokens.reasoning, 0);
    const totalCacheCost = records.reduce((sum, r) => sum + r.actualTokens.cache.read, 0);
    const totalCostReal = records.reduce((sum, r) => sum + r.realCost, 0);

    // Accuracy breakdown (by tier accuracy grade)
    const accuracyBreakdown: AccuracyBreakdown = {
      optimal: (records.filter(r => r.tierAccuracy === 'OPTIMAL').length / records.length) * 100,
      right: (records.filter(r => r.tierAccuracy === 'RIGHT').length / records.length) * 100,
      acceptable: (records.filter(r => r.tierAccuracy === 'ACCEPTABLE').length / records.length) * 100,
      suboptimal: (records.filter(r => r.tierAccuracy === 'SUBOPTIMAL').length / records.length) * 100,
      overshot: (records.filter(r => r.tierAccuracy === 'OVERSHOT').length / records.length) * 100,
    };

    // Estimation error (only for records that have estimates)
    const recordsWithEstimates = records.filter(r => r.estimatedTokens);
    const averageInputEstimationError = recordsWithEstimates.length > 0
      ? recordsWithEstimates.reduce((sum, r) => sum + r.estimationError.input, 0) / recordsWithEstimates.length
      : 0;
    const averageOutputEstimationError = recordsWithEstimates.length > 0
      ? recordsWithEstimates.reduce((sum, r) => sum + r.estimationError.output, 0) / recordsWithEstimates.length
      : 0;

    // Cost comparison
    const totalTokens = totalInputTokens + totalOutputTokens;
    const costIfAllDefault = (5 * totalTokens) / 1000; // medium = 5x, default baseline
    const costIfAllHeavy = (20 * totalTokens) / 1000; // heavy = 20x

    // Average cost ratio of delegated tiers
    const totalCostRatioUsed = records.reduce((sum, r) => {
      if (r.delegatedTier === 'unknown') return sum + 1; // treat unknown as 1x
      const ratio = cfg.tiers[r.delegatedTier as TierName]?.costRatio ?? 1;
      return sum + ratio;
    }, 0);
    const averageActualCostRatio = records.length > 0 ? totalCostRatioUsed / records.length : 0;

    return {
      sessionId: records[0].sessionId,
      records,
      startTime: Math.min(...records.map(r => r.timestamp)),
      endTime: Math.max(...records.map(r => r.timestamp)),
      totalInputTokens,
      totalOutputTokens,
      totalReasoningTokens,
      totalCacheCost,
      totalCostReal,
      accuracyBreakdown,
      averageInputEstimationError,
      averageOutputEstimationError,
      costSavedVsDefault: costIfAllDefault - totalCostReal,
      costSavedVsHeavy: costIfAllHeavy - totalCostReal,
      averageActualCostRatio,
    };
  }
}
