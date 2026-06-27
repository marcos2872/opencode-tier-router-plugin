/**
 * Token Commands — Integration Layer
 *
 * Responsibility: Define and execute token tracking commands
 * - /token-report <sessionId> — Show metrics for a session
 * - /token-history — List all persisted sessions
 * - /token-compare <sessionId> <tier> — Estimate cost with different tier
 *
 * RTT-T9, RTT-T10, RTT-T11: Command definitions and handlers
 */

import type { TokenTracker } from './token-tracker.js';

/**
 * Token command types
 */
export type TokenCommand = 'token-report' | 'token-history' | 'token-compare';

/**
 * Execute a token command via the tracker.
 *
 * RTT-T9: /token-report <sessionId>
 * RTT-T10: /token-history
 * RTT-T11: /token-compare <sessionId> <tier>
 *
 * @param tracker - Token tracker instance, or `null`/`undefined` to return no result.
 * @param command - Command name, optionally prefixed with `/`.
 * @param args - Command arguments string.
 * @returns Command output, or `null` when the command is unknown or unavailable.
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
 * Check if a command is a token tracking command.
 *
 * @param command - Command name, optionally prefixed with `/`.
 * @returns `true` when the command is a supported token command.
 */
export function isTokenCommand(command: string): boolean {
  const cmd = command.toLowerCase().replace(/^\//, '').trim();
  return ['token-report', 'token-history', 'token-compare'].includes(cmd);
}

/**
 * Get help text for token tracking commands.
 *
 * @returns Multi-line help text describing each token command.
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
