/**
 * Metrics Aggregator — Domain Layer
 *
 * Responsibility: Aggregate TokenRecords into SessionTokenSummary
 * Calculate tier accuracy based on actual token usage
 * Zero I/O, pure business logic
 */

import type { TokenRecord, TokenUsage } from './token-event-parser.js';
import type { RouterConfig, TierName } from './config.js';

/**
 * Tier accuracy grade calculated from token usage and config thresholds.
 */
export type TierAccuracy = 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT' | 'UNKNOWN';

/**
 * Accuracy breakdown by grade, expressed as percentages.
 */
export interface AccuracyBreakdown {
  /**
   * Percentage of records classified as optimal.
   */
  optimal: number;

  /**
   * Percentage of records classified as right-tier fits.
   */
  right: number;

  /**
   * Percentage of records classified as acceptable overages or small tasks.
   */
  acceptable: number;

  /**
   * Percentage of records classified as under-provisioned tiers.
   */
  suboptimal: number;

  /**
   * Percentage of records classified as overshot tiers.
   */
  overshot: number;
}

/**
 * Aggregated metrics for one token tracking session.
 */
export interface SessionTokenSummary {
  /**
   * OpenCode session ID.
   */
  sessionId: string;

  /**
   * Token records included in this summary.
   */
  records: TokenRecord[];

  /**
   * Earliest captured step timestamp in the session.
   */
  startTime: number;

  /**
   * Latest captured step timestamp in the session.
   */
  endTime: number;

  /**
   * Total input tokens.
   */
  totalInputTokens: number;

  /**
   * Total output tokens.
   */
  totalOutputTokens: number;

  /**
   * Total reasoning tokens.
   */
  totalReasoningTokens: number;

  /**
   * Total cache read tokens.
   */
  totalCacheCost: number;

  /**
   * Total actual cost.
   */
  totalCostReal: number;

  /**
   * Accuracy breakdown by grade.
   */
  accuracyBreakdown: AccuracyBreakdown;

  /**
   * Average input token estimation error percentage.
   */
  averageInputEstimationError: number;

  /**
   * Average output token estimation error percentage.
   */
  averageOutputEstimationError: number;

  /**
   * Cost saved compared with the medium/default baseline.
   */
  costSavedVsDefault: number;

  /**
   * Cost saved compared with the heavy baseline.
   */
  costSavedVsHeavy: number;

  /**
   * Average observed cost ratio for delegated tiers.
   */
  averageActualCostRatio: number;
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
    *
    * @param totalTokens - Total token count to classify.
    * @param tier - Tier to classify.
    * @param cfg - Router config containing tier thresholds.
    * @returns Tier accuracy grade.
    */
   calculateTierAccuracy(
    totalTokens: number,
    tier: 'fast' | 'medium' | 'heavy' | 'unknown',
    cfg: RouterConfig,
  ): TierAccuracy;

   /**
    * Aggregate all records from a session into a summary with metrics.
    *
    * @param records - Token records to aggregate.
    * @param cfg - Router config containing tier cost ratios.
    * @returns Aggregated session summary.
    */
   aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary;
}

/**
 * DefaultMetricsAggregator
 *
 * Reference implementation: standard aggregation and accuracy calculation.
 */
export class DefaultMetricsAggregator implements MetricsAggregator {
  /**
   * Calculate tier accuracy based on total tokens and configured thresholds.
   *
   * @param totalTokens - Total token count to classify.
   * @param tier - Tier to classify.
   * @param cfg - Router config containing tier thresholds.
   * @returns Tier accuracy grade.
   * @example
   * ```ts
   * const accuracy = aggregator.calculateTierAccuracy(5000, 'medium', config);
   * ```
   */
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

  /**
   * Aggregate token records into a session summary with cost and accuracy metrics.
   *
   * @param records - Token records to aggregate.
   * @param cfg - Router config containing tier cost ratios.
   * @returns Aggregated session summary.
   * @example
   * ```ts
   * const summary = aggregator.aggregateSessionMetrics(records, config);
   * ```
   */
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
