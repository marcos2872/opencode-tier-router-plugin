/** Tamanho do protocolo de delegação em tokens */
export const TOKEN_PROTOCOL_SIZE = 210;

/** Número máximo de entradas de cache de sessão na memória */
export const LRU_MAX_SESSIONS = 100;

/** TTL de sessão antes da evicção (em minutos) */
export const SESSION_TTL_MINUTES = 30;

/** Número máximo de eventos órfãos no buffer antes da limpeza */
export const ORPHAN_BUFFER_SIZE = 10000;

/** Intervalo de limpeza do buffer de eventos órfãos (em milissegundos) */
export const CLEANUP_INTERVAL_MS = 10 * 1000;

/** Número máximo de arquivos de histórico para manter em disco */
export const MAX_HISTORY_FILES = 50;

/** Número máximo de dias de histórico para manter em disco */
export const MAX_HISTORY_DAYS = 30;

/** Divisor de custo (tokens por mil) */
export const COST_DIVISOR = 1000;

/** Tamanho máximo de entrada JSON para análise segura (1MB) */
export const MAX_JSON_SIZE = 1024 * 1024;

/** Custo padrão por 1K tokens de entrada (USD) */
export const DEFAULT_INPUT_COST_PER_1K = 0.0015;

/** Custo padrão por 1K tokens de saída (USD) */
export const DEFAULT_OUTPUT_COST_PER_1K = 0.006;

/** Comprimento máximo para tarefas rápidas triviais */
export const TRIVIAL_TASK_MAX_LENGTH = 120;

/** Limiar de aviso do cap (%) */
export const CAP_WARNING_THRESHOLD = 80;

/** Limiar de aviso do cap em chamadas restantes */
export const CAP_WARNING_REMAINING_THRESHOLD = 2;

/** Cap máximo padrão por tier */
export const DEFAULT_TIER_CAP = 8;

/** Razão de custo padrão do tier fast */
export const DEFAULT_FAST_COST_RATIO = 1;

/** Razão de custo padrão do tier medium */
export const DEFAULT_MEDIUM_COST_RATIO = 5;

/** Razão de custo padrão do tier heavy */
export const DEFAULT_HEAVY_COST_RATIO = 20;

/** Cap padrão do tier medium */
export const DEFAULT_MEDIUM_TIER_CAP = 12;

/** Cap padrão do tier heavy */
export const DEFAULT_HEAVY_TIER_CAP = 20;

/** Limite máximo de tokens do tier fast */
export const FAST_TIER_MAX_TOKENS = 2000;

/** Limite máximo de tokens do tier medium */
export const MEDIUM_TIER_MAX_TOKENS = 10000;

/** Limite mínimo de tokens do tier heavy */
export const HEAVY_TIER_MIN_TOKENS = 10000;

/** Tentativas máximas de retry de eventos órfãos */
export const ORPHAN_MAX_ATTEMPTS = 5;

/** Intervalo de retry de eventos órfãos (em milissegundos) */
export const ORPHAN_RETRY_INTERVAL_MS = 1000;

/** Tempo máximo de espera de eventos órfãos (em milissegundos) */
export const ORPHAN_MAX_WAIT_MS = 5000;

/** Minutos por hora */
export const MINUTES_PER_HOUR = 60;

/** Milissegundos por minuto */
export const MILLISECONDS_PER_MINUTE = 1000;
