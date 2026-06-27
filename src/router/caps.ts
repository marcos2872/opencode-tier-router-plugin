import { CAP_WARNING_REMAINING_THRESHOLD, DEFAULT_TIER_CAP } from '../constants.js';

const READ_ONLY_TOOLS = new Set(['grep', 'read', 'glob', 'ls']);
const DEFAULT_MAX = DEFAULT_TIER_CAP;
const WARNING_THRESHOLD_REMAINING = CAP_WARNING_REMAINING_THRESHOLD;

/**
 * CapTracker gerencia limites de chamadas de ferramenta por sessão e avisos de redundância.
 *
 * O tracker conta chamadas de ferramenta somente leitura e registra impressão digital de chamadas
 * somente leitura repetidas para que o orquestrador possa avisar quando a mesma operação de leitura
 * é repetida ou quando um limite configurado é atingido.
 */
export interface CapTracker {
  /**
   * Registra uma chamada de ferramenta para uma sessão e atualiza os contadores de limite.
   *
   * @param sessionId - Identificador da sessão OpenCode.
   * @param tool - Nome da ferramenta a registrar.
   * @param args - Argumentos da ferramenta usados para registrar impressão digital de chamadas somente leitura.
   * @returns Nada.
   */
  record(sessionId: string, tool: string, args: Record<string, unknown>): void;

  /**
   * Cria um banner para a chamada de ferramenta mais recente em uma sessão.
   *
   * @param sessionId - Identificador da sessão OpenCode.
   * @param tool - Nome da ferramenta a inspecionar.
   * @param args - Argumentos da ferramenta usados para detectar chamadas somente leitura repetidas.
   * @returns Uma string de aviso/banner, ou uma string vazia quando nenhum banner se aplica.
   */
  getBanner(sessionId: string, tool: string, args: Record<string, unknown>): string;
}

/**
 * Cria um tracker de caps com limite configurável de chamadas somente leitura.
 *
 * @param max - Máximo de chamadas somente leitura permitidas antes de exibir banner de limite.
 * @returns Uma implementação de CapTracker.
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
 * Retorna estado de sessão existente ou cria quando ausente.
 *
 * @param sessions - Mapa de estados de sessão de propriedade do tracker.
 * @param sessionId - Identificador da sessão OpenCode.
 * @returns O estado atual da sessão.
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
 * Determina se uma ferramenta é considerada somente leitura.
 *
 * @param tool - Nome da ferramenta.
 * @returns `true` quando a ferramenta está na lista permitida de ferramentas somente leitura.
 */
function isReadOnly(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool.toLowerCase());
}

/**
 * Cria uma impressão digital para uma chamada de ferramenta somente leitura.
 *
 * A impressão digital é derivada do nome da ferramenta e dos argumentos
 * ordenados não indefinidos. Retorna `null` para ferramentas não somente leitura
 * ou conjuntos de argumentos vazios.
 *
 * @param tool - Nome da ferramenta.
 * @param args - Argumentos da ferramenta.
 * @returns Uma string de impressão digital determinística, ou `null` quando indisponível.
 */
function buildFingerprint(tool: string, args: Record<string, unknown>): string | null {
  if (!isReadOnly(tool)) return null;

  const lowerTool = tool.toLowerCase();
  const normalized = normalizeArgs(args);
  if (!normalized) return null;
  return `${lowerTool}:${normalized}`;
}

/**
 * Normaliza argumentos de ferramenta somente leitura em uma string estável.
 *
 * @param args - Argumentos da ferramenta a normalizar.
 * @returns Uma string de argumentos ordenada, ou `null` quando argumentos estão vazios.
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
