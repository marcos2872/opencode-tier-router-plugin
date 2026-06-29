/**
 * Tamanho do protocolo de delegação em tokens (~210 tokens para system prompt).
 */
export const TOKEN_PROTOCOL_SIZE = 210;

/**
 * Comprimento máximo em caracteres para considerar uma tarefa como rápida e trivial.
 */
export const TRIVIAL_TASK_MAX_LENGTH = 120;

/**
 * Limiar percentual do cap para exibir aviso (80%).
 */
export const CAP_WARNING_THRESHOLD = 80;

/**
 * Número de chamadas restantes para exibir aviso de cap.
 */
export const CAP_WARNING_REMAINING_THRESHOLD = 2;

/**
 * TTL de sessão em milissegundos para cleanup de estado stale (30 minutos).
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Ferramentas nativas bloqueadas antes da execução em sessões principais hard-blocked.
 */
export const HARD_BLOCK_DENIED_TOOLS = [
  'grep',
  'glob',
  'read',
  'list',
  'bash',
  'edit',
  'write',
  'webfetch',
  'websearch',
] as const;

export const OPENCODE_ROUTER_TIER = 'OPENCODE_ROUTER_TIER';
export const OPENCODE_ROUTER_MODE = 'OPENCODE_ROUTER_MODE';
export const OPENCODE_ROUTER_HARD_BLOCKED = 'OPENCODE_ROUTER_HARD_BLOCKED';

/**
 * Cap máximo padrão de chamadas de ferramenta por tier.
 */
export const DEFAULT_TIER_CAP = 8;

/**
 * Razão de custo padrão do tier fast (1x — modelo mais barato).
 */
export const DEFAULT_FAST_COST_RATIO = 1;

/**
 * Razão de custo padrão do tier medium (5x).
 */
export const DEFAULT_MEDIUM_COST_RATIO = 5;

/**
 * Razão de custo padrão do tier heavy (20x — modelo mais caro).
 */
export const DEFAULT_HEAVY_COST_RATIO = 20;

/**
 * Cap padrão de chamadas do tier medium (mais permissivo que fast).
 */
export const DEFAULT_MEDIUM_TIER_CAP = 12;

/**
 * Cap padrão de chamadas do tier heavy (mais permissivo).
 */
export const DEFAULT_HEAVY_TIER_CAP = 20;

/**
 * Limite máximo de tokens acumulados para ser considerado tier fast.
 */
export const FAST_TIER_MAX_TOKENS = 2000;

/**
 * Limite máximo de tokens acumulados para ser considerado tier medium.
 */
export const MEDIUM_TIER_MAX_TOKENS = 10000;

/**
 * Limite mínimo de tokens a partir do qual a tarefa é considerada heavy.
 */
export const HEAVY_TIER_MIN_TOKENS = 10000;

/**
 * Diretório para arquivos temporários de delegação de hard-block.
 */
export const DELEGATION_TMP_DIR = '/tmp/opencode-router-model';
