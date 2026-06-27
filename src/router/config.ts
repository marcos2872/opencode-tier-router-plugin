import { access, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_FAST_COST_RATIO,
  DEFAULT_HEAVY_COST_RATIO,
  DEFAULT_HEAVY_TIER_CAP,
  DEFAULT_MEDIUM_COST_RATIO,
  DEFAULT_MEDIUM_TIER_CAP,
  DEFAULT_TIER_CAP,
  FAST_TIER_MAX_TOKENS,
  HEAVY_TIER_MIN_TOKENS,
  LRU_MAX_SESSIONS,
  MAX_HISTORY_DAYS,
  MAX_HISTORY_FILES,
  MEDIUM_TIER_MAX_TOKENS,
  SESSION_TTL_MINUTES,
} from '../constants.js';

/**
 * Tier name used by the router.
 */
export type TierName = 'fast' | 'medium' | 'heavy';

/**
 * Token threshold bounds for a tier.
 */
export interface TokenThresholds {
  /**
   * Minimum token count for this tier.
   */
  min: number;

  /**
   * Maximum token count for this tier, or `null` for unlimited.
   */
  max: number | null;
}

/**
 * Configuration for one router tier.
 */
export interface TierConfig {
  /**
   * OpenCode model identifier for this tier.
   */
  model: string;

  /**
   * Relative cost multiplier for this tier.
   */
  costRatio: number;

  /**
   * Maximum allowed call count for this tier.
   */
  cap: number;

  /**
   * Optional token threshold bounds for this tier.
   */
  thresholds?: TokenThresholds;
}

/**
 * Configuration for a routing mode.
 */
export interface ModeConfig {
  /**
   * Human-readable description of the mode.
   */
  description?: string;

  /**
   * Default tier name selected when no classifier matches.
   */
  defaultTier: string;
}

/**
 * Keyword patterns grouped by tier.
 */
export interface TaskPatterns {
  /**
   * Keywords that should route to the fast tier.
   */
  fast: string[];

  /**
   * Keywords that should route to the medium tier.
   */
  medium: string[];

  /**
   * Keywords that should route to the heavy tier.
   */
  heavy: string[];
}

/**
 * Enforcement policy for delegation.
 */
export interface EnforcementConfig {
  /**
   * Enforcement mode: advisory hints or hard-block.
   */
  mode: 'advisory' | 'hard-block';

  /**
   * Whether trivial fast tasks may execute directly.
   */
  trivialDirectAllowed: boolean;
}

/**
 * Routing configuration for strategy selection.
 */
export interface RoutingConfig {
  /**
   * Routing strategy to use.
   */
  strategy: 'keyword' | 'llm';

  /**
   * Selector model used when `llm` routing is enabled.
   */
  selectorModel: string;

  /**
   * Selector timeout in milliseconds.
   */
  selectorTimeoutMs: number;

  /**
   * Maximum selector output tokens.
   */
  selectorMaxTokens: number;
}

/**
 * Token tracking configuration.
 */
export interface TokenTrackingConfig {
  /**
   * Whether token tracking is enabled when present.
   */
  enabled?: boolean;

  /**
   * Maximum persisted token metric files to retain.
   */
  maxHistoryFiles?: number;

  /**
   * Maximum days to retain historical token records.
   */
  maxHistoryDays?: number;

  /**
   * Session TTL in minutes before eviction.
   */
  sessionTTLMinutes?: number;

  /**
   * Maximum number of sessions kept in memory before LRU eviction.
   */
  maxSessionsMemory?: number;
}

/**
 * Complete router configuration.
 */
export interface RouterConfig {
  /**
   * Active routing mode name.
   */
  mode: string;

  /**
   * Tier definitions keyed by tier name.
   */
  tiers: Record<string, TierConfig>;

  /**
   * Routing modes keyed by mode name.
   */
  modes: Record<string, ModeConfig>;

  /**
   * Tier keyword patterns.
   */
  taskPatterns: TaskPatterns;

  /**
   * Enforcement policy.
   */
  enforcement: EnforcementConfig;

  /**
   * Routing strategy configuration.
   */
  routing: RoutingConfig;

  /**
   * Optional token tracking configuration.
   */
  tokenTracking?: TokenTrackingConfig;
}

/**
 * Active tier summary for the selected mode.
 */
export interface ActiveTiers {
  /**
   * Default tier for the active mode.
   */
  defaultTier: string;

  /**
   * Tier definitions available to the router.
   */
  tiers: Record<string, TierConfig>;
}

/**
 * Configuration error thrown when tiers.json is invalid.
 */
export class ConfigError extends Error {
  /**
   * Create a configuration error with an optional underlying cause.
   *
   * @param message - Human-readable error message.
   * @param cause - Underlying error or reason for the invalid configuration.
   */
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_CONFIG: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: {
      model: 'github-copilot/claude-haiku-4.5',
      costRatio: DEFAULT_FAST_COST_RATIO,
      cap: DEFAULT_TIER_CAP,
      thresholds: { min: 0, max: FAST_TIER_MAX_TOKENS }, // ✅ ERRO-003: Default thresholds
    },
    medium: {
      model: 'github-copilot/gpt-5.3-codex',
      costRatio: DEFAULT_MEDIUM_COST_RATIO,
      cap: DEFAULT_MEDIUM_TIER_CAP,
      thresholds: { min: FAST_TIER_MAX_TOKENS, max: MEDIUM_TIER_MAX_TOKENS },
    },
    heavy: {
      model: 'github-copilot/claude-sonnet-4.5',
      costRatio: DEFAULT_HEAVY_COST_RATIO,
      cap: DEFAULT_HEAVY_TIER_CAP,
      thresholds: { min: HEAVY_TIER_MIN_TOKENS, max: null }, // unlimited
    },
  },
  modes: {
    normal: {
      description: 'Balanced routing: fast for search, medium for implementation, heavy for architecture/debug',
      defaultTier: 'medium',
    },
    budget: {
      description: 'Cost-first: prefer @fast whenever possible',
      defaultTier: 'fast',
    },
    quality: {
      description: 'Quality-first: prefer @medium and @heavy over @fast',
      defaultTier: 'medium',
    },
    deep: {
      description: 'Depth-first: route architecture and debug tasks to @heavy',
      defaultTier: 'heavy',
    },
  },
  taskPatterns: {
    fast: [
      'find',
      'grep',
      'search',
      'where',
      'locate',
      'list',
      'show',
      'read',
      'explore',
      'buscar',
      'busque',
      'busca',
      'procurar',
      'procure',
      'procura',
      'ler',
      'leia',
      'listar',
      'liste',
      'mostrar',
      'mostre',
    ],
    medium: [
      'refactor',
      'implement',
      'add',
      'write',
      'fix',
      'update',
      'change',
      'create',
      'edit',
      'rename',
      'implementar',
      'refatorar',
      'adicionar',
      'corrigir',
      'atualizar',
      'criar',
      'editar',
      'renomear',
      'validar',
    ],
    heavy: [
      'design',
      'architecture',
      'debug',
      'complex',
      'explain',
      'reason',
      'analyze',
      'optimize',
      'quality',
      'review',
      'arquitetura',
      'depurar',
      'complexo',
      'analisar',
      'otimizar',
      'qualidade',
      'revisar',
      'diagnosticar',
    ],
  },
  enforcement: {
    mode: 'hard-block',
    trivialDirectAllowed: false, // ✅ CRITICAL: Always delegate, never allow direct execution
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
  tokenTracking: {
    enabled: true,
    maxHistoryFiles: MAX_HISTORY_FILES, // ✅ ERRO-005: Bounded disk (50 files max)
    maxHistoryDays: MAX_HISTORY_DAYS,
    sessionTTLMinutes: SESSION_TTL_MINUTES, // ✅ ERRO-004: 30-min TTL
    maxSessionsMemory: LRU_MAX_SESSIONS, // ✅ ERRO-004: Max 100 sessions in memory
  },
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the tiers.json path using project-local override then global fallback.
 *
 * If both project and global files exist, the project-local file wins. If
 * neither exists, the function returns the project-local path so callers can
 * create it there.
 *
 * @param projectDir - Directory containing the OpenCode project.
 * @param globalDir - Directory containing the global OpenCode config.
 * @returns The resolved tiers.json path.
 * @example
 * ```ts
 * const path = await resolveTiersPath(process.cwd(), join(homedir(), '.config', 'opencode'));
 * ```
 */
export async function resolveTiersPath(projectDir: string, globalDir: string): Promise<string> {
  const projectPath = join(projectDir, 'tiers.json');
  if (await pathExists(projectPath)) return projectPath;

  const globalPath = join(globalDir, 'tiers.json');
  if (await pathExists(globalPath)) return globalPath;

  return projectPath;
}

/**
 * Load and validate tiers.json from the resolved config path.
 *
 * The function reads a project-local config first, falls back to global config,
 * and throws ConfigError when the file is unreadable or malformed.
 *
 * @param projectDir - Directory containing the OpenCode project.
 * @param globalDir - Directory containing the global OpenCode config.
 * @returns Validated router configuration.
 * @throws {ConfigError} When the config cannot be read, parsed, or validated.
 * @example
 * ```ts
 * const cfg = await loadTiers(process.cwd(), join(homedir(), '.config', 'opencode'));
 * ```
 */
export async function loadTiers(projectDir: string, globalDir: string): Promise<RouterConfig> {
  const path = await resolveTiersPath(projectDir, globalDir);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Failed to read tiers config at ${path}`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Malformed JSON in tiers config at ${path}`, err);
  }

  validateConfig(parsed);
  return parsed as RouterConfig;
}

/**
 * Validate and normalize a raw tiers.json object.
 *
 * The function accepts partial config and fills defaults for enforcement and
 * routing sections when they are missing, but it throws for malformed required
 * fields. It is intentionally permissive about unknown top-level properties.
 *
 * @param config - Raw parsed JSON object to validate.
 * @throws {ConfigError} When the config is invalid or incomplete.
 * @returns Nothing; if validation succeeds, `config` is narrowed to RouterConfig.
 * @example
 * ```ts
 * validateConfig({ mode: 'normal', tiers: {}, modes: {} });
 * ```
 */
export function validateConfig(config: unknown): asserts config is RouterConfig {
  if (config === null || typeof config !== 'object') {
    throw new ConfigError('tiers.json must be a JSON object');
  }

  const cfg = config as Partial<RouterConfig>;

  if (!cfg.enforcement || typeof cfg.enforcement !== 'object') {
    cfg.enforcement = structuredClone(DEFAULT_CONFIG.enforcement);
  }

  const enforcement = cfg.enforcement as Partial<EnforcementConfig>;
  if (enforcement.mode !== 'advisory' && enforcement.mode !== 'hard-block') {
    throw new ConfigError('enforcement.mode must be "advisory" or "hard-block"');
  }
  if (typeof enforcement.trivialDirectAllowed !== 'boolean') {
    throw new ConfigError('enforcement.trivialDirectAllowed must be boolean');
  }

  if (!cfg.routing || typeof cfg.routing !== 'object') {
    cfg.routing = structuredClone(DEFAULT_CONFIG.routing);
  }

  const routing = cfg.routing as Partial<RoutingConfig>;
  if (routing.strategy !== 'keyword' && routing.strategy !== 'llm') {
    throw new ConfigError('routing.strategy must be "keyword" or "llm"');
  }
  if (typeof routing.selectorModel !== 'string' || routing.selectorModel.length === 0) {
    throw new ConfigError('routing.selectorModel must be a non-empty string');
  }
  if (typeof routing.selectorTimeoutMs !== 'number' || !Number.isFinite(routing.selectorTimeoutMs) || routing.selectorTimeoutMs <= 0) {
    throw new ConfigError('routing.selectorTimeoutMs must be a positive number');
  }
  if (typeof routing.selectorMaxTokens !== 'number' || !Number.isFinite(routing.selectorMaxTokens) || routing.selectorMaxTokens <= 0) {
    throw new ConfigError('routing.selectorMaxTokens must be a positive number');
  }

  if (typeof cfg.mode !== 'string' || cfg.mode.length === 0) {
    throw new ConfigError('mode must be a non-empty string');
  }

  if (!cfg.modes || typeof cfg.modes !== 'object') {
    throw new ConfigError('modes must be an object');
  }

  if (!cfg.modes[cfg.mode]) {
    throw new ConfigError(`active mode "${cfg.mode}" is not defined in modes`);
  }

  if (!cfg.tiers || typeof cfg.tiers !== 'object') {
    throw new ConfigError('tiers must be an object');
  }

  for (const [modeName, mode] of Object.entries(cfg.modes)) {
    if (!mode || typeof mode !== 'object') {
      throw new ConfigError(`mode "${modeName}" must be an object`);
    }
    const defaultTier = (mode as Partial<ModeConfig>).defaultTier;
    if (typeof defaultTier !== 'string' || defaultTier.length === 0) {
      throw new ConfigError(`mode "${modeName}" is missing defaultTier`);
    }
    if (!cfg.tiers[defaultTier]) {
      throw new ConfigError(`mode "${modeName}" defaultTier "${defaultTier}" does not exist in tiers`);
    }
  }

  for (const [tierName, tier] of Object.entries(cfg.tiers)) {
    if (!tier || typeof tier !== 'object') {
      throw new ConfigError(`tier "${tierName}" must be an object`);
    }
    const t = tier as Partial<TierConfig>;
    if (typeof t.model !== 'string' || t.model.length === 0) {
      throw new ConfigError(`tier "${tierName}" is missing a model`);
    }
    if (typeof t.costRatio !== 'number' || !Number.isFinite(t.costRatio) || t.costRatio <= 0) {
      throw new ConfigError(`tier "${tierName}" costRatio must be a positive number`);
    }
    if (typeof t.cap !== 'number' || !Number.isFinite(t.cap) || t.cap <= 0) {
      throw new ConfigError(`tier "${tierName}" cap must be a positive number`);
    }
    // ✅ ERRO-003: Validate thresholds if present
    if (t.thresholds) {
      if (typeof t.thresholds !== 'object') {
        throw new ConfigError(`tier "${tierName}" thresholds must be an object`);
      }
      const th = t.thresholds as Partial<TokenThresholds>;
      if (typeof th.min !== 'number' || !Number.isFinite(th.min) || th.min < 0) {
        throw new ConfigError(`tier "${tierName}" thresholds.min must be a non-negative number`);
      }
      if (th.max !== null && (typeof th.max !== 'number' || !Number.isFinite(th.max) || th.max < th.min!)) {
        throw new ConfigError(`tier "${tierName}" thresholds.max must be null or a number >= min`);
      }
    }
  }

  if (!cfg.taskPatterns || typeof cfg.taskPatterns !== 'object') {
    throw new ConfigError('taskPatterns must be an object');
  }

  for (const tierName of Object.keys(cfg.tiers)) {
    const patterns = (cfg.taskPatterns as unknown as Record<string, unknown>)[tierName];
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new ConfigError(`taskPatterns for tier "${tierName}" must be a non-empty array`);
    }
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new ConfigError(`taskPatterns for tier "${tierName}" must contain non-empty strings`);
      }
    }
  }

  // ✅ ERRO-003, ERRO-004, ERRO-005: Validate tokenTracking if present
  if (cfg.tokenTracking) {
    if (typeof cfg.tokenTracking !== 'object') {
      throw new ConfigError('tokenTracking must be an object');
    }
    const tt = cfg.tokenTracking as Partial<TokenTrackingConfig>;
    if (tt.enabled !== undefined && typeof tt.enabled !== 'boolean') {
      throw new ConfigError('tokenTracking.enabled must be boolean');
    }
    if (tt.maxHistoryFiles !== undefined && (typeof tt.maxHistoryFiles !== 'number' || !Number.isFinite(tt.maxHistoryFiles) || tt.maxHistoryFiles < 1)) {
      throw new ConfigError('tokenTracking.maxHistoryFiles must be a positive number');
    }
    if (tt.maxHistoryDays !== undefined && (typeof tt.maxHistoryDays !== 'number' || !Number.isFinite(tt.maxHistoryDays) || tt.maxHistoryDays < 1)) {
      throw new ConfigError('tokenTracking.maxHistoryDays must be a positive number');
    }
    if (tt.sessionTTLMinutes !== undefined && (typeof tt.sessionTTLMinutes !== 'number' || !Number.isFinite(tt.sessionTTLMinutes) || tt.sessionTTLMinutes < 1)) {
      throw new ConfigError('tokenTracking.sessionTTLMinutes must be a positive number');
    }
    if (tt.maxSessionsMemory !== undefined && (typeof tt.maxSessionsMemory !== 'number' || !Number.isFinite(tt.maxSessionsMemory) || tt.maxSessionsMemory < 1)) {
      throw new ConfigError('tokenTracking.maxSessionsMemory must be a positive number');
    }
  }
}

/**
 * Save the active routing mode to project-local tiers.json.
 *
 * The function creates the project directory if needed, reads the existing
 * project config when present, updates `mode`, and writes a temporary file
 * before renaming it into place.
 *
 * @param mode - Mode name to activate.
 * @param projectDir - Directory where tiers.json should be written.
 * @returns Updated router configuration.
 * @throws {ConfigError} When the mode is unknown, the existing config is malformed, or writing fails.
 * @example
 * ```ts
 * const cfg = await saveMode('budget', process.cwd());
 * ```
 */
export async function saveMode(mode: string, projectDir: string): Promise<RouterConfig> {
  if (typeof mode !== 'string' || mode.length === 0) {
    throw new ConfigError('mode must be a non-empty string');
  }

  if (!DEFAULT_CONFIG.modes[mode]) {
    throw new ConfigError(`unknown mode "${mode}"`);
  }

  const projectPath = join(projectDir, 'tiers.json');
  let cfg: RouterConfig;

  if (await pathExists(projectPath)) {
    const raw = await readFile(projectPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Cannot update tiers.json: existing file is malformed`, err);
    }
    validateConfig(parsed);
    cfg = parsed as RouterConfig;
  } else {
    cfg = structuredClone(DEFAULT_CONFIG);
  }

  cfg.mode = mode;

  await mkdir(projectDir, { recursive: true });

  const tmpPath = join(projectDir, 'tiers.json.tmp');
  try {
    await writeFile(tmpPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    await rename(tmpPath, projectPath);
  } catch (err) {
    throw new ConfigError(`Failed to write tiers.json at ${projectPath}`, err);
  }

  return cfg;
}

/**
 * Return the active mode default tier and configured tier map.
 *
 * @param cfg - Router configuration to inspect.
 * @returns Active tier summary for the configured mode.
 * @throws {ConfigError} When the active mode is unknown.
 * @example
 * ```ts
 * const active = getActiveTiers(config);
 * ```
 */
export function getActiveTiers(cfg: RouterConfig): ActiveTiers {
  const mode = cfg.modes[cfg.mode];
  if (!mode) {
    throw new ConfigError(`unknown mode "${cfg.mode}"`);
  }
  return { defaultTier: mode.defaultTier, tiers: cfg.tiers };
}
