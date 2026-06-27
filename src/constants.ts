/** Delegation protocol size in tokens */
export const TOKEN_PROTOCOL_SIZE = 210;

/** Maximum session cache entries in memory */
export const LRU_MAX_SESSIONS = 100;

/** Session TTL before eviction (in minutes) */
export const SESSION_TTL_MINUTES = 30;

/** Maximum orphan events in buffer before cleanup */
export const ORPHAN_BUFFER_SIZE = 10000;

/** Cleanup interval for orphan buffer (milliseconds) */
export const CLEANUP_INTERVAL_MS = 10 * 1000;

/** Maximum history files to keep on disk */
export const MAX_HISTORY_FILES = 50;

/** Maximum history days to keep on disk */
export const MAX_HISTORY_DAYS = 30;

/** Cost divisor (tokens per thousand) */
export const COST_DIVISOR = 1000;

/** Maximum JSON input size for safe parsing (1MB) */
export const MAX_JSON_SIZE = 1024 * 1024;

/** Default cost per 1K input tokens (USD) */
export const DEFAULT_INPUT_COST_PER_1K = 0.0015;

/** Default cost per 1K output tokens (USD) */
export const DEFAULT_OUTPUT_COST_PER_1K = 0.006;

/** Trivial fast task max length */
export const TRIVIAL_TASK_MAX_LENGTH = 120;

/** Cap warning threshold (%) */
export const CAP_WARNING_THRESHOLD = 80;

/** Cap warning threshold in remaining calls */
export const CAP_WARNING_REMAINING_THRESHOLD = 2;

/** Default max cap per tier */
export const DEFAULT_TIER_CAP = 8;

/** Default fast tier cost ratio */
export const DEFAULT_FAST_COST_RATIO = 1;

/** Default medium tier cost ratio */
export const DEFAULT_MEDIUM_COST_RATIO = 5;

/** Default heavy tier cost ratio */
export const DEFAULT_HEAVY_COST_RATIO = 20;

/** Default medium tier cap */
export const DEFAULT_MEDIUM_TIER_CAP = 12;

/** Default heavy tier cap */
export const DEFAULT_HEAVY_TIER_CAP = 20;

/** Fast tier maximum token threshold */
export const FAST_TIER_MAX_TOKENS = 2000;

/** Medium tier maximum token threshold */
export const MEDIUM_TIER_MAX_TOKENS = 10000;

/** Heavy tier minimum token threshold */
export const HEAVY_TIER_MIN_TOKENS = 10000;

/** Orphan max retry attempts */
export const ORPHAN_MAX_ATTEMPTS = 5;

/** Orphan retry interval (milliseconds) */
export const ORPHAN_RETRY_INTERVAL_MS = 1000;

/** Orphan max wait time (milliseconds) */
export const ORPHAN_MAX_WAIT_MS = 5000;

/** Minutes per hour */
export const MINUTES_PER_HOUR = 60;

/** Milliseconds per minute */
export const MILLISECONDS_PER_MINUTE = 1000;
