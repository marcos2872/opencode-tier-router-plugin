import { calculateCost } from './cost-calculator.js';

/**
 * Rastreador de Eventos de Token — Camada de domínio
 *
 * Responsabilidade: Analisar StepFinishEvent → TokenRecord
 * Sem lógica de negócio, transformação pura de dados
 * Sem I/O, sem dependências externas
 */

/**
 * Detalhamento do uso de tokens capturado em uma etapa de execução de modelo/ferramenta.
 */
export interface TokenUsage {
  /**
   * Tokens de entrada usados pela etapa.
   */
  input: number;

  /**
   * Tokens de saída gerados pela etapa.
   */
  output: number;

  /**
   * Tokens de raciocínio usados pela etapa.
   */
  reasoning: number;

  /**
   * Contagens de tokens de leitura/escrita em cache.
   */
  cache: { read: number; write: number };
}

/**
 * Decisão de roteamento usada para correlacionar uso de tokens com uma camada selecionada.
 */
export interface RoutingDecision {
  /**
   * Nome da camada selecionada.
   */
  tier: 'fast' | 'medium' | 'heavy' | 'unknown';

  /**
   * Multiplicador da razão de custo da camada selecionada.
   */
  costRatio: number;

  /**
   * Contagens estimadas opcionais de tokens de entrada/saída usadas para comparação de custo.
   */
  estimated?: { input: number; output: number };
}

/**
 * Registro de domínio de token persistido e agregado para uma sessão.
 */
export interface TokenRecord {
  /**
   * Identificador da sessão do OpenCode associado à etapa.
   */
  sessionId: string;

  /**
   * Marca de tempo Unix da etapa capturada.
   */
  timestamp: number;

  /**
   * Uso real de tokens capturado da execução.
   */
  actualTokens: TokenUsage;

  /**
   * Custo real associado à execução.
   */
  realCost: number;

  /**
   * Camada selecionada pelo roteador para esta etapa.
   */
  delegatedTier: 'fast' | 'medium' | 'heavy' | 'unknown';

  /**
   * Modelo usado para a etapa.
   */
  modelUsed: string;

  /**
   * Contagens estimadas opcionais de tokens de entrada/saída do roteamento.
   */
  estimatedTokens?: { input: number; output: number };

  /**
   * Custo estimado opcional do roteamento.
   */
  estimatedCost?: number;

  /**
   * Grau de acurácia da camada calculado pelo agregador.
   */
  tierAccuracy: 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT' | 'UNKNOWN';

  /**
   * Erro de estimativa em percentuais para tokens de entrada e saída.
   */
  estimationError: {
    /**
     * Percentual de erro de estimativa de token de entrada.
     */
    input: number;

    /**
     * Percentual de erro de estimativa de token de saída.
     */
    output: number;
  };

  /**
   * Total de tokens usado para cálculos de custo e relatório.
   */
  totalTokensUsed: number;
}

/**
 * Evento bruto step-finish emitido por um gancho de execução de ferramenta.
 */
export interface StepFinishEvent {
  /**
   * Tipo de evento, esperado como `step-finish`.
   */
  type?: 'step-finish';

  /**
   * Identificador da sessão do OpenCode associado à etapa.
   */
  sessionID: string;

  /**
   * Marca de tempo Unix opcional para o evento.
   */
  timestamp?: number;

  /**
   * Custo real associado ao evento.
   */
  cost: number;

  /**
   * Uso real de tokens capturado no evento.
   */
  tokens: TokenUsage;
}

/**
 * Interface TokenEventParser
 *
 * Porta: abstração para analisar StepFinishEvent em TokenRecord de domínio.
 * Permite testes com implementações simuladas.
 */
export interface TokenEventParser {
  /**
   * Analisa um evento step-finish em TokenRecord.
   * Se routingDecision for fornecido, correlaciona o evento com a decisão.
   * Caso contrário, o registro terá delegatedTier='unknown'.
   *
   * @param event - Evento bruto step-finish a ser analisado.
   * @param routingDecision - Decisão de roteamento opcional para correlacionar com o registro analisado.
   * @returns Registro de token analisado com uso real e metadados de roteamento opcionais.
   */
  parse(event: StepFinishEvent, routingDecision?: RoutingDecision): TokenRecord;
}

/**
 * DefaultTokenEventParser
 *
 * Implementação de referência: análise direta sem lógica de negócio.
 */
export class DefaultTokenEventParser implements TokenEventParser {
  /**
   * Analisa um evento step-finish em um registro de domínio de token.
   *
   * O parser preserva uso real de tokens e custo, preenche padrões de timestamp
   * e adiciona metadados opcionais de roteamento quando uma decisão é fornecida.
   *
   * @param event - Evento bruto step-finish a ser analisado.
   * @param routingDecision - Decisão de roteamento opcional para correlacionar com o registro analisado.
   * @returns Registro de token analisado com uso real e metadados de roteamento opcionais.
   * @example
   * ```ts
   * const parser = new DefaultTokenEventParser();
   * const record = parser.parse(event);
   * ```
   */
  parse(event: StepFinishEvent, routingDecision?: RoutingDecision): TokenRecord {
    const totalTokensUsed = event.tokens.input +
                           event.tokens.output +
                           event.tokens.reasoning +
                           event.tokens.cache.read;

    const record: TokenRecord = {
      sessionId: event.sessionID,
      timestamp: event.timestamp ?? Date.now(),
      actualTokens: event.tokens,
      realCost: event.cost,
      delegatedTier: routingDecision?.tier ?? 'unknown',
      modelUsed: 'unknown', // will be enriched from context if needed
      estimatedTokens: routingDecision?.estimated,
      estimatedCost: routingDecision?.estimated && calculateCost(routingDecision.estimated, { costRatio: routingDecision.costRatio }),
      tierAccuracy: 'UNKNOWN', // will be calculated by aggregator
      estimationError: { input: 0, output: 0 }, // will be calculated by aggregator
      totalTokensUsed,
    };

    return record;
  }
}
