/**
 * Metrics Formatter — Presentation Layer
 *
 * Responsibility: Format SessionTokenSummary for display
 * ✅ OCP: Add new formats without modifying domain logic
 * Strategies: Markdown (MVP), can extend to CSV, JSON later
 */

import type { SessionTokenSummary } from './metrics-aggregator.js';
import type { PersistedTokenSession } from './token-tracker.js';
import type { TierName } from './config.js';

/**
 * MetricsFormatter interface
 *
 * Abstraction for formatting metrics into various output formats.
 */
export interface MetricsFormatter {
  /**
   * Format session summary as report string (markdown, csv, json, etc).
   */
  formatReport(summary: SessionTokenSummary): string;

  /**
   * Format list of persisted sessions as history string.
   */
  formatHistory(sessions: PersistedTokenSession[]): string;

  /**
   * Format comparison: what if all delegations went to a different tier?
   */
  formatComparison(summary: SessionTokenSummary, compareTier: TierName): string;
}

/**
 * MarkdownMetricsFormatter
 *
 * Reference implementation: formats as GitHub-flavored markdown.
 * Human-readable, renders nicely in chat interfaces.
 */
export class MarkdownMetricsFormatter implements MetricsFormatter {
  formatReport(summary: SessionTokenSummary): string {
    const durationMs = summary.endTime - summary.startTime;
    const durationSecs = Math.floor(durationMs / 1000);

    const lines = [
      '## Real Token Cost Report',
      `**Session:** \`${summary.sessionId}\``,
      `**Requests:** ${summary.records.length}`,
      `**Duration:** ${durationSecs}s`,
      '',
      '### Usage Summary',
      `Total tokens: ${summary.totalInputTokens + summary.totalOutputTokens + summary.totalReasoningTokens}`,
      `  - Input: ${summary.totalInputTokens}`,
      `  - Output: ${summary.totalOutputTokens}`,
      `  - Reasoning: ${summary.totalReasoningTokens}`,
      `  - Cache read: ${summary.totalCacheCost}`,
      `Total real cost: ${summary.totalCostReal.toFixed(6)}`,
      `Average cost ratio: ${summary.averageActualCostRatio.toFixed(1)}x`,
      '',
      '### Tier Accuracy',
      `✅ Right: ${summary.accuracyBreakdown.right.toFixed(1)}%`,
      `✅ Optimal: ${summary.accuracyBreakdown.optimal.toFixed(1)}%`,
      `⚠️ Acceptable: ${summary.accuracyBreakdown.acceptable.toFixed(1)}%`,
      `❌ Suboptimal: ${summary.accuracyBreakdown.suboptimal.toFixed(1)}%`,
      `❌ Overshot: ${summary.accuracyBreakdown.overshot.toFixed(1)}%`,
      '',
      '### Estimation Accuracy',
      `Input estimation error: ${summary.averageInputEstimationError.toFixed(1)}%`,
      `Output estimation error: ${summary.averageOutputEstimationError.toFixed(1)}%`,
      '',
      '### Cost Comparison',
      `Actual cost: ${summary.totalCostReal.toFixed(6)}`,
      `If all @medium (5x): ${(summary.totalCostReal + summary.costSavedVsDefault).toFixed(6)}`,
      `Savings vs default: ${summary.costSavedVsDefault.toFixed(6)} (${
        ((summary.costSavedVsDefault / (summary.totalCostReal + summary.costSavedVsDefault)) * 100).toFixed(1)
      }%)`,
      `If all @heavy (20x): ${(summary.totalCostReal + summary.costSavedVsHeavy).toFixed(6)}`,
      `Savings vs heavy: ${summary.costSavedVsHeavy.toFixed(6)} (${
        ((summary.costSavedVsHeavy / (summary.totalCostReal + summary.costSavedVsHeavy)) * 100).toFixed(1)
      }%)`,
    ];

    return lines.join('\n');
  }

  formatHistory(sessions: PersistedTokenSession[]): string {
    if (sessions.length === 0) {
      return 'No saved token reports yet.';
    }

    const lines = [
      '## Token Tracking History',
      '| Session | Requests | Tokens | Cost | Accuracy | Savings |',
      '|---------|----------|--------|------|----------|---------|',
    ];

    for (const session of sessions) {
      const tokens = session.summary.totalInputTokens + session.summary.totalOutputTokens;
      const accuracy = session.summary.accuracyBreakdown.right + session.summary.accuracyBreakdown.acceptable;
      const savingsPercent = ((session.summary.costSavedVsDefault /
        (session.summary.totalCostReal + session.summary.costSavedVsDefault)) *
        100).toFixed(0);

      lines.push(
        `| \`${session.sessionId.slice(0, 8)}\` | ${session.delegationCount} | ${tokens} | ${session.summary.totalCostReal.toFixed(6)} | ${accuracy.toFixed(0)}% | ${savingsPercent}% |`,
      );
    }

    return lines.join('\n');
  }

  formatComparison(summary: SessionTokenSummary, compareTier: TierName): string {
    const costRatios: Record<TierName, number> = {
      fast: 1,
      medium: 5,
      heavy: 20,
    };

    const compareRatio = costRatios[compareTier] ?? 1;
    const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
    const costIfAll = (compareRatio * totalTokens) / 1000;
    const difference = costIfAll - summary.totalCostReal;
    const differencePercent = (difference / costIfAll) * 100;

    const lines = [
      `## Tier Comparison: All routed to @${compareTier}`,
      `Cost if all @${compareTier}: ${costIfAll.toFixed(6)}`,
      `Actual cost: ${summary.totalCostReal.toFixed(6)}`,
      `Difference: ${difference.toFixed(6)} (${differencePercent.toFixed(1)}%)`,
      '',
      differencePercent > 0
        ? `✅ Current routing is **${Math.abs(differencePercent).toFixed(1)}% cheaper** than @${compareTier}`
        : `⚠️ Current routing is **${Math.abs(differencePercent).toFixed(1)}% more expensive** than @${compareTier}`,
    ];

    return lines.join('\n');
  }
}
