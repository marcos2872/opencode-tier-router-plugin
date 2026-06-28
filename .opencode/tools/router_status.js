import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_CONFIG = {
  mode: 'normal',
  tiers: {
    fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
    medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
    heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
  },
  modes: {
    normal: { description: 'Balanced routing', defaultTier: 'medium' },
    budget: { description: 'Cost-first', defaultTier: 'fast' },
    quality: { description: 'Quality-first', defaultTier: 'medium' },
    deep: { description: 'Depth-first', defaultTier: 'heavy' },
  },
  taskPatterns: {
    fast: ['find', 'grep', 'search'],
    medium: ['implement', 'refactor', 'fix'],
    heavy: ['design', 'architecture', 'debug'],
  },
  enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
  routing: { strategy: 'keyword', selectorModel: 'github-copilot/claude-haiku-4.5', selectorTimeoutMs: 1200, selectorMaxTokens: 16 },
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTier(tier) {
  if (!isRecord(tier) || typeof tier.model !== 'string' || typeof tier.costRatio !== 'number' || typeof tier.cap !== 'number') {
    return undefined;
  }
  if (tier.costRatio <= 0 || tier.cap <= 0) return undefined;
  return { model: tier.model, costRatio: tier.costRatio, cap: tier.cap };
}

function normalizeTiers(tiers) {
  const normalized = {};
  if (!isRecord(tiers)) return normalized;

  for (const [name, tier] of Object.entries(tiers)) {
    const normalizedTier = normalizeTier(tier);
    if (normalizedTier) normalized[name] = normalizedTier;
  }

  return normalized;
}

function normalizeConfig(config) {
  if (!isRecord(config)) return structuredClone(DEFAULT_CONFIG);

  const normalized = structuredClone(DEFAULT_CONFIG);
  normalized.mode = typeof config.mode === 'string' && config.mode ? config.mode : normalized.mode;
  normalized.tiers = normalizeTiers(config.tiers);
  normalized.modes = isRecord(config.modes) ? config.modes : normalized.modes;
  normalized.taskPatterns = isRecord(config.taskPatterns) ? config.taskPatterns : normalized.taskPatterns;
  normalized.enforcement = isRecord(config.enforcement) ? config.enforcement : normalized.enforcement;
  normalized.routing = isRecord(config.routing) ? config.routing : normalized.routing;

  if (!normalized.modes[normalized.mode]) normalized.mode = 'normal';
  if (!normalized.tiers[normalized.modes[normalized.mode].defaultTier]) normalized.mode = 'normal';
  if (!normalized.tiers[normalized.modes[normalized.mode].defaultTier]) return structuredClone(DEFAULT_CONFIG);

  return normalized;
}

async function loadTiers(projectDir) {
  const projectPath = join(projectDir, 'tiers.json');
  if (existsSync(projectPath)) {
    try {
      const raw = await readFile(projectPath, 'utf8');
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  const globalPath = join(process.env.HOME || '', '.config', 'opencode', 'tiers.json');
  if (existsSync(globalPath)) {
    try {
      const raw = await readFile(globalPath, 'utf8');
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  return structuredClone(DEFAULT_CONFIG);
}

async function buildRouterStatus(sessionContext = {}) {
  const context = isRecord(sessionContext) ? sessionContext : {};
  const directory = context.directory || context.worktree || process.cwd();
  const runtimeState = context.routerStatus || context.routingState || context.router || {};
  const hardBlockCount = Number.isFinite(Number(runtimeState.hardBlockCount)) ? Number(runtimeState.hardBlockCount) : 0;

  const config = await loadTiers(directory);
  return {
    enabled: runtimeState.enabled ?? context.enabled ?? true,
    mode: config.mode,
    tiers: config.tiers,
    hardBlockCount,
  };
}

export { buildRouterStatus };

export default async function routerStatus(sessionContext = {}) {
  return JSON.stringify(await buildRouterStatus(sessionContext), null, 2);
}
