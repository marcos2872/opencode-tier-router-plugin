/**
 * Token Event Parser — Domain Layer
 *
 * Responsibility: Parse StepFinishEvent → TokenRecord
 * Zero business logic, pure data transformation
 * Zero I/O, zero external dependencies
 */

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface RoutingDecision {
  tier: 'fast' | 'medium' | 'heavy' | 'unknown';
  costRatio: number;
  estimated?: { input: number; output: number };
}

export interface TokenRecord {
  // Event data (REAL)
  sessionId: string;
  timestamp: number;
  actualTokens: TokenUsage;
  realCost: number;

  // Routing decision (from memory, correlated)
  delegatedTier: 'fast' | 'medium' | 'heavy' | 'unknown';
  modelUsed: string;
  estimatedTokens?: { input: number; output: number };
  estimatedCost?: number;

  // Calculated by aggregator
  tierAccuracy: 'OPTIMAL' | 'RIGHT' | 'ACCEPTABLE' | 'SUBOPTIMAL' | 'OVERSHOT' | 'UNKNOWN';
  estimationError: {
    input: number;  // percentage
    output: number; // percentage
  };
  totalTokensUsed: number; // input + output + reasoning + cache.read
}

export interface StepFinishEvent {
  type: 'step-finish';
  sessionID: string;
  timestamp?: number;
  cost: number;
  tokens: TokenUsage;
}

/**
 * TokenEventParser interface
 *
 * Port: abstraction for parsing StepFinishEvent into domain TokenRecord.
 * Allows testing with mock implementations.
 */
export interface TokenEventParser {
  /**
   * Parse a step-finish event into a TokenRecord.
   * If routingDecision is provided, correlate event with decision.
   * If not, record will have delegatedTier='unknown'.
   */
  parse(event: StepFinishEvent, routingDecision?: RoutingDecision): TokenRecord;
}

/**
 * DefaultTokenEventParser
 *
 * Reference implementation: straightforward parsing with no business logic.
 */
export class DefaultTokenEventParser implements TokenEventParser {
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
      estimatedCost: routingDecision?.estimated && routingDecision.costRatio
        ? (routingDecision.costRatio * (routingDecision.estimated.input + routingDecision.estimated.output)) / 1000
        : undefined,
      tierAccuracy: 'UNKNOWN', // will be calculated by aggregator
      estimationError: { input: 0, output: 0 }, // will be calculated by aggregator
      totalTokensUsed,
    };

    return record;
  }
}
