import { CAP_WARNING_REMAINING_THRESHOLD, DEFAULT_TIER_CAP } from '../constants.js';

const READ_ONLY_TOOLS = new Set(['grep', 'read', 'glob', 'ls']);
const DEFAULT_MAX = DEFAULT_TIER_CAP;
const WARNING_THRESHOLD_REMAINING = CAP_WARNING_REMAINING_THRESHOLD;

/**
 * CapTracker manages per-session tool-call caps and redundancy warnings.
 *
 * The tracker counts read-only tool calls and fingerprints repeated
 * read-only calls so the orchestrator can warn when the same read operation
 * is repeated or when a configured cap is reached.
 */
export interface CapTracker {
  /**
   * Record a tool call for a session and update cap counters.
   *
   * @param sessionId - OpenCode session identifier.
   * @param tool - Tool name to record.
   * @param args - Tool arguments used to fingerprint read-only calls.
   * @returns Nothing.
   */
  record(sessionId: string, tool: string, args: Record<string, unknown>): void;

  /**
   * Build a banner for the latest tool call in a session.
   *
   * @param sessionId - OpenCode session identifier.
   * @param tool - Tool name to inspect.
   * @param args - Tool arguments used to detect repeated read-only calls.
   * @returns A warning/banner string, or an empty string when no banner applies.
   */
  getBanner(sessionId: string, tool: string, args: Record<string, unknown>): string;
}

/**
 * Create a cap tracker with a configurable maximum read-only call count.
 *
 * @param max - Maximum allowed read-only calls before a cap banner is shown.
 * @returns A CapTracker implementation.
 * @example
 * ```ts
 * const tracker = createCapTracker(3);
 * tracker.record('sess-1', 'read', { path: 'src/index.ts' });
 * ```
 */
export function createCapTracker(max = DEFAULT_MAX): CapTracker {
  const sessions = new Map<string, SessionState>();

  return {
    record(sessionId, tool, args) {
      const state = getSessionState(sessions, sessionId);
      const callNumber = ++state.callCounter;

      if (isReadOnly(tool)) {
        state.readCount++;
      }

      const fingerprint = buildFingerprint(tool, args);
      if (fingerprint && !state.fingerprints.has(fingerprint)) {
        state.fingerprints.set(fingerprint, callNumber);
      }
    },

    getBanner(sessionId, tool, args) {
      const state = sessions.get(sessionId);
      if (!state) return '';

      const banners: string[] = [];
      const fingerprint = buildFingerprint(tool, args);

      if (fingerprint) {
        const previousCall = state.fingerprints.get(fingerprint);
        if (previousCall !== undefined && previousCall !== state.callCounter) {
          banners.push(`[⚠ REDUNDANT: this is the same ${tool} you ran at call #${previousCall}]`);
        }
      }

      if (isReadOnly(tool)) {
        const count = state.readCount;
        const remaining = max - count;

        if (count >= max) {
          banners.push(`[⚠ CAP REACHED (${count}/${max})]`);
        } else if (remaining <= WARNING_THRESHOLD_REMAINING) {
          banners.push(`[⚠ CAP WARNING: ${remaining} remaining]`);
        } else {
          banners.push(`[cap: ${count}/${max}]`);
        }
      }

      return banners.join(' ');
    },
  };
}

interface SessionState {
  callCounter: number;
  readCount: number;
  fingerprints: Map<string, number>;
}

/**
 * Return existing session state or create it when absent.
 *
 * @param sessions - Session state map owned by the tracker.
 * @param sessionId - OpenCode session identifier.
 * @returns The current session state.
 */
function getSessionState(sessions: Map<string, SessionState>, sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { callCounter: 0, readCount: 0, fingerprints: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

/**
 * Determine whether a tool is considered read-only.
 *
 * @param tool - Tool name.
 * @returns `true` when the tool is in the read-only whitelist.
 */
function isReadOnly(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool.toLowerCase());
}

/**
 * Build a fingerprint for a read-only tool call.
 *
 * The fingerprint is derived from the tool name and sorted, non-undefined
 * arguments. It returns `null` for non-read-only tools or empty argument sets.
 *
 * @param tool - Tool name.
 * @param args - Tool arguments.
 * @returns A deterministic fingerprint string, or `null` when unavailable.
 */
function buildFingerprint(tool: string, args: Record<string, unknown>): string | null {
  if (!isReadOnly(tool)) return null;

  const lowerTool = tool.toLowerCase();
  const normalized = normalizeArgs(args);
  if (!normalized) return null;
  return `${lowerTool}:${normalized}`;
}

/**
 * Normalize read-only tool arguments into a stable string.
 *
 * @param args - Tool arguments to normalize.
 * @returns A sorted argument string, or `null` when arguments are empty.
 */
function normalizeArgs(args: Record<string, unknown>): string | null {
  if (args === null || typeof args !== 'object') return null;

  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;

  const parts = entries.map(([key, value]) => {
    return `${key}=${String(value)}`;
  });

  return parts.join(':');
}
