/**
 * Agregador de Métricas — Camada de Domínio
 *
 * Responsabilidade: Agregar TokenRecords em SessionTokenSummary
 * Calcula a precisão do tier com base no uso real de tokens
 * Sem I/O, lógica de negócio pura
 */

import type { TokenRecord, TokenUsage } from './token-event-parser.js';
import type { RouterConfig, TierName } from './config.js';

/**
 * Grau de precisão do tier calculado a partir do uso de tokens e dos limites da config.
 */
export type TierAccuracy = 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT' | 'UNKNOWN';

/**
 * Divisão da precisão por grau, expressa em porcentagens.
 */
export interface AccuracyBreakdown {
  /**
   * Percentual de registros classificados como optimal.
   */
  optimal: number;

  /**
   * Percentual de registros classificados como ajustes adequados ao tier.
   */
  right: number;

  /**
   * Percentual de registros classificados como excedentes aceitáveis ou pequenas tarefas.
   */
  acceptable: number;

  /**
   * Percentual de registros classificados como tiers subdimensionados.
   */
  suboptimal: number;

  /**
   * Percentual de registros classificados como tiers superdimensionados.
   */
  overshot: number;
}

/**
 * Métricas agregadas para uma sessão de rastreamento de tokens.
 */
export interface SessionTokenSummary {
  /**
   * ID da sessão OpenCode.
   */
  sessionId: string;

  /**
   * Registros de tokens incluídos neste resumo.
   */
  records: TokenRecord[];

  /**
   * Primeira marca temporal capturada da etapa na sessão.
   */
  startTime: number;

  /**
   * Última marca temporal capturada da etapa na sessão.
   */
  endTime: number;

  /**
   * Total de tokens de entrada.
   */
  totalInputTokens: number;

  /**
   * Total de tokens de saída.
   */
  totalOutputTokens: number;

  /**
   * Total de tokens de raciocínio.
   */
  totalReasoningTokens: number;

  /**
   * Total de tokens de leitura em cache.
   */
  totalCacheCost: number;

  /**
   * Custo real total.
   */
  totalCostReal: number;

  /**
   * Divisão da precisão por grau.
   */
  accuracyBreakdown: AccuracyBreakdown;

  /**
   * Erro percentual médio de estimativa de tokens de entrada.
   */
  averageInputEstimationError: number;

  /**
   * Erro percentual médio de estimativa de tokens de saída.
   */
  averageOutputEstimationError: number;

  /**
   * Custo economizado em comparação com a baseline média/default.
   */
  costSavedVsDefault: number;

  /**
   * Custo economizado em comparação com a baseline heavy.
   */
  costSavedVsHeavy: number;

  /**
   * Proporção de custo real média para tiers delegados.
   */
  averageActualCostRatio: number;
}

/**
 * Interface MetricsAggregator
 *
 * Porta: abstração para lógica de agregação e cálculo de precisão.
 * Permite testes com implementações mock.
 */
export interface MetricsAggregator {
  /**
   * Calcula a precisão do tier com base no uso real de tokens e no tier delegado.
   * Usa limites da config.
   *
   * @param totalTokens - Quantidade total de tokens a classificar.
   * @param tier - Tier a classificar.
   * @param cfg - Configuração do roteador contendo os limites do tier.
   * @returns Grau de precisão do tier.
   */
  calculateTierAccuracy(
    totalTokens: number,
    tier: 'fast' | 'medium' | 'heavy' | 'unknown',
    cfg: RouterConfig,
  ): TierAccuracy;

  /**
   * Agrega todos os registros de uma sessão em um resumo com métricas.
   *
   * @param records - Registros de tokens a serem agregados.
   * @param cfg - Configuração do roteador contendo as proporções de custo do tier.
   * @returns Resumo da sessão agregada.
   */
  aggregateSessionMetrics(records: TokenRecord[], cfg: RouterConfig): SessionTokenSummary;
}

/**
 * DefaultMetricsAggregator
 *
 * Implementação de referência: agregação e cálculo de precisão padrão.
 */
export class DefaultMetricsAggregator implements MetricsAggregator {
  /**
   * Calcula a precisão do tier com base no total de tokens e nos limites configurados.
   *
   * @param totalTokens - Quantidade total de tokens a classificar.
   * @param tier - Tier a classificar.
   * @param cfg - Configuração do roteador contendo os limites do tier.
   * @returns Grau de precisão do tier.
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
   * Agrega registros de tokens em um resumo de sessão com métricas de custo e precisão.
   *
   * @param records - Registros de tokens a serem agregados.
   * @param cfg - Configuração do roteador contendo as proporções de custo do tier.
   * @returns Resumo da sessão agregada.
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
      optimal: (records.filter((r) => r.tierAccuracy === 'OPTIMAL').length / records.length) * 100,
      right: (records.filter((r) => r.tierAccuracy === 'RIGHT').length / records.length) * 100,
      acceptable: (records.filter((r) => r.tierAccuracy === 'ACCEPTABLE').length / records.length) * 100,
      suboptimal: (records.filter((r) => r.tierAccuracy === 'SUBOPTIMAL').length / records.length) * 100,
      overshot: (records.filter((r) => r.tierAccuracy === 'OVERSHOT').length / records.length) * 100,
    };

    // Estimation error (only for records that have estimates)
    const recordsWithEstimates = records.filter((r) => r.estimatedTokens);
    const averageInputEstimationError =
      recordsWithEstimates.length > 0
        ? recordsWithEstimates.reduce((sum, r) => sum + r.estimationError.input, 0) / recordsWithEstimates.length
        : 0;
    const averageOutputEstimationError =
      recordsWithEstimates.length > 0
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
      startTime: Math.min(...records.map((r) => r.timestamp)),
      endTime: Math.max(...records.map((r) => r.timestamp)),
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
