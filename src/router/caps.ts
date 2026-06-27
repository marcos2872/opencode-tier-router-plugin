const READ_ONLY_TOOLS = new Set(['grep', 'read', 'glob', 'ls']);
const DEFAULT_MAX = 8;
const WARNING_THRESHOLD_REMAINING = 2;

export interface CapTracker {
  record(sessionId: string, tool: string, args: Record<string, unknown>): void;
  getBanner(sessionId: string, tool: string, args: Record<string, unknown>): string;
}

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

function getSessionState(sessions: Map<string, SessionState>, sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { callCounter: 0, readCount: 0, fingerprints: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

function isReadOnly(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool.toLowerCase());
}

function buildFingerprint(tool: string, args: Record<string, unknown>): string | null {
  if (!isReadOnly(tool)) return null;

  const lowerTool = tool.toLowerCase();
  const normalized = normalizeArgs(args);
  if (!normalized) return null;
  return `${lowerTool}:${normalized}`;
}

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
