import { access, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface TierConfig {
  model: string;
  costRatio: number;
  cap: number;
}

export interface ModeConfig {
  description?: string;
  defaultTier: string;
}

export interface TaskPatterns {
  fast: string[];
  medium: string[];
  heavy: string[];
}

export interface RouterConfig {
  mode: string;
  tiers: Record<string, TierConfig>;
  modes: Record<string, ModeConfig>;
  taskPatterns: TaskPatterns;
}

export interface ActiveTiers {
  defaultTier: string;
  tiers: Record<string, TierConfig>;
}

export class ConfigError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_CONFIG: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
    medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
    heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
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
    fast: ['find', 'grep', 'search', 'where', 'locate', 'list', 'show', 'read', 'explore'],
    medium: ['refactor', 'implement', 'add', 'write', 'fix', 'update', 'change', 'create', 'edit', 'rename'],
    heavy: ['design', 'architecture', 'debug', 'complex', 'explain', 'reason', 'analyze', 'optimize'],
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

export async function resolveTiersPath(projectDir: string, globalDir: string): Promise<string> {
  const projectPath = join(projectDir, 'tiers.json');
  if (await pathExists(projectPath)) return projectPath;

  const globalPath = join(globalDir, 'tiers.json');
  if (await pathExists(globalPath)) return globalPath;

  return projectPath;
}

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

export function validateConfig(config: unknown): asserts config is RouterConfig {
  if (config === null || typeof config !== 'object') {
    throw new ConfigError('tiers.json must be a JSON object');
  }

  const cfg = config as Partial<RouterConfig>;

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
}

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

export function getActiveTiers(cfg: RouterConfig): ActiveTiers {
  const mode = cfg.modes[cfg.mode];
  if (!mode) {
    throw new ConfigError(`unknown mode "${cfg.mode}"`);
  }
  return { defaultTier: mode.defaultTier, tiers: cfg.tiers };
}
