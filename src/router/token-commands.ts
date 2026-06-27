/**
 * Comandos de Token — Camada de integração
 *
 * Responsabilidade: Definir e executar comandos de rastreamento de tokens
 * - /token-report <sessionId> — Exibir métricas de uma sessão
 * - /token-history — Listar todas as sessões persistidas
 * - /token-compare <sessionId> <tier> — Estimar custo com outra camada
 *
 * RTT-T9, RTT-T10, RTT-T11: Definições e manipuladores de comandos
 */

import type { TokenTracker } from './token-tracker.js';

/**
 * Tipos de comando de token
 */
export type TokenCommand = 'token-report' | 'token-history' | 'token-compare';

/**
 * Executa um comando de token por meio do rastreador.
 *
 * RTT-T9: /token-report <sessionId>
 * RTT-T10: /token-history
 * RTT-T11: /token-compare <sessionId> <tier>
 *
 * @param tracker - Instância do rastreador de tokens, ou `null`/`undefined` para retornar sem resultado.
 * @param command - Nome do comando, opcionalmente prefixado com `/`.
 * @param args - Texto de argumentos do comando.
 * @returns Saída do comando, ou `null` quando o comando for desconhecido ou indisponível.
 * @example
 * ```ts
 * const result = await executeTokenCommand(tracker, 'token-report', 'sess-abc123');
 * ```
 */
export async function executeTokenCommand(
  tracker: TokenTracker | null | undefined,
  command: string | null | undefined,
  args: string | null | undefined,
): Promise<string | null> {
  try {
    // Defensive: handle null/undefined tracker or command
    if (!tracker || !command) {
      return null;
    }

    const cmd = String(command).toLowerCase().trim();
    const argsStr = String(args ?? '').trim();

    // /token-report <sessionId>
    if (cmd === 'token-report') {
      const sessionId = argsStr;
      if (!sessionId) {
        return 'Usage: /token-report <sessionId>';
      }
      return await tracker.getSessionReport(sessionId);
    }

    // /token-history
    if (cmd === 'token-history') {
      return await tracker.getHistory();
    }

    // /token-compare <sessionId> <tier>
    if (cmd === 'token-compare') {
      const parts = argsStr.split(/\s+/);
      const sessionId = parts[0];
      const tier = parts[1] as 'fast' | 'medium' | 'heavy' | undefined;

      if (!sessionId || !tier) {
        return 'Usage: /token-compare <sessionId> <fast|medium|heavy>';
      }

      if (!['fast', 'medium', 'heavy'].includes(tier)) {
        return 'Invalid tier. Use: fast, medium, or heavy';
      }

      return await tracker.getComparison(sessionId, tier);
    }

    // Unknown command
    return null;
  } catch (err) {
    // Best-effort: never throw, return error message
    console.error('[TokenCommands] Error executing command:', err);
    return `Error executing command: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Verifica se um comando é um comando de rastreamento de tokens.
 *
 * @param command - Nome do comando, opcionalmente prefixado com `/`.
 * @returns `true` quando o comando for um comando de token suportado.
 */
export function isTokenCommand(command: string): boolean {
  const cmd = command.toLowerCase().replace(/^\//, '').trim();
  return ['token-report', 'token-history', 'token-compare'].includes(cmd);
}

/**
 * Obtém texto de ajuda para comandos de rastreamento de tokens.
 *
 * @returns Texto de ajuda em múltiplas linhas descrevendo cada comando de token.
 * @example
 * ```ts
 * const help = getTokenCommandsHelp();
 * ```
 */
export function getTokenCommandsHelp(): string {
  return `
Token Tracking Commands:

  /token-report <sessionId>
    Show real token metrics for a session
    Example: /token-report sess-abc123
    
  /token-history
    List all persisted token tracking sessions
    
  /token-compare <sessionId> <tier>
    Estimate cost if session were delegated to different tier
    Example: /token-compare sess-abc123 heavy
    Tiers: fast (1x), medium (5x), heavy (20x)
`;
}
