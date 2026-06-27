import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ConfigError,
  resolveTiersPath,
  loadTiers,
  saveMode,
  getActiveTiers,
  validateConfig,
  type RouterConfig,
} from '../src/router/config.js';

async function makeTempDirs(prefix: string) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const projectDir = join(base, 'project');
  const globalDir = join(base, 'global');
  await mkdir(projectDir, { recursive: true });
  await mkdir(globalDir, { recursive: true });
  return {
    projectDir,
    globalDir,
    async cleanup() {
      await rm(base, { recursive: true, force: true });
    },
  };
}

const validConfig: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'openai/gpt-4.1-nano', costRatio: 1, cap: 8 },
    medium: { model: 'anthropic/claude-sonnet-4-5', costRatio: 5, cap: 12 },
    heavy: { model: 'anthropic/claude-opus-4', costRatio: 20, cap: 20 },
  },
  modes: {
    normal: { description: 'Balanced', defaultTier: 'medium' },
    budget: { description: 'Cheap', defaultTier: 'fast' },
    quality: { description: 'Better', defaultTier: 'medium' },
    deep: { description: 'Deep', defaultTier: 'heavy' },
  },
  taskPatterns: {
    fast: ['find', 'grep'],
    medium: ['refactor', 'implement'],
    heavy: ['design', 'architecture'],
  },
  enforcement: {
    mode: 'advisory',
    trivialDirectAllowed: true,
  },
};

describe('resolveTiersPath', () => {
  it('prefers project tiers.json over global', async () => {
    const dirs = await makeTempDirs('resolve-prefers-');
    try {
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(validConfig));
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify({ mode: 'budget' }));
      const resolved = await resolveTiersPath(dirs.projectDir, dirs.globalDir);
      expect(resolved).toBe(join(dirs.projectDir, 'tiers.json'));
    } finally {
      await dirs.cleanup();
    }
  });

  it('falls back to global tiers.json when project file is missing', async () => {
    const dirs = await makeTempDirs('resolve-global-');
    try {
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify(validConfig));
      const resolved = await resolveTiersPath(dirs.projectDir, dirs.globalDir);
      expect(resolved).toBe(join(dirs.globalDir, 'tiers.json'));
    } finally {
      await dirs.cleanup();
    }
  });

  it('returns project path when both files are missing', async () => {
    const dirs = await makeTempDirs('resolve-missing-');
    try {
      const resolved = await resolveTiersPath(dirs.projectDir, dirs.globalDir);
      expect(resolved).toBe(join(dirs.projectDir, 'tiers.json'));
    } finally {
      await dirs.cleanup();
    }
  });
});

describe('loadTiers', () => {
  it('loads the project config when it exists', async () => {
    const dirs = await makeTempDirs('load-project-');
    try {
      const projectConfig = { ...validConfig, mode: 'quality' };
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(projectConfig));
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify({ ...validConfig, mode: 'deep' }));
      const cfg = await loadTiers(dirs.projectDir, dirs.globalDir);
      expect(cfg.mode).toBe('quality');
      expect(cfg.tiers.fast.model).toBe('openai/gpt-4.1-nano');
    } finally {
      await dirs.cleanup();
    }
  });

  it('loads the global config when project file is missing', async () => {
    const dirs = await makeTempDirs('load-global-');
    try {
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify({ ...validConfig, mode: 'budget' }));
      const cfg = await loadTiers(dirs.projectDir, dirs.globalDir);
      expect(cfg.mode).toBe('budget');
    } finally {
      await dirs.cleanup();
    }
  });

  it('throws ConfigError for malformed JSON', async () => {
    const dirs = await makeTempDirs('load-malformed-');
    try {
      await writeFile(join(dirs.projectDir, 'tiers.json'), '{ not json');
      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });

  it('throws ConfigError when a tier model is missing', async () => {
    const dirs = await makeTempDirs('load-missing-model-');
    try {
      const bad = structuredClone(validConfig);
      bad.tiers.fast.model = '';
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));
      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });

  it('throws ConfigError when a costRatio is not positive', async () => {
    const dirs = await makeTempDirs('load-cost-ratio-');
    try {
      const bad = structuredClone(validConfig);
      bad.tiers.medium.costRatio = 0;
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));
      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });

  it('throws ConfigError when taskPatterns are empty', async () => {
    const dirs = await makeTempDirs('load-patterns-');
    try {
      const bad = structuredClone(validConfig);
      bad.taskPatterns.fast = [];
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));
      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });

  it('throws ConfigError when active mode is unknown', async () => {
    const dirs = await makeTempDirs('load-mode-');
    try {
      const bad = { ...validConfig, mode: 'unknown' };
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));
      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });
});

describe('saveMode', () => {
  it('creates tiers.json with defaults when file is absent', async () => {
    const dirs = await makeTempDirs('save-create-');
    try {
      await saveMode('budget', dirs.projectDir);
      const raw = await readFile(join(dirs.projectDir, 'tiers.json'), 'utf8');
      const parsed = JSON.parse(raw) as RouterConfig;
      expect(parsed.mode).toBe('budget');
      expect(parsed.tiers.fast.model).toBeDefined();
      expect(parsed.tiers.heavy.cap).toBeGreaterThan(0);
    } finally {
      await dirs.cleanup();
    }
  });

  it('updates only mode while preserving existing fields', async () => {
    const dirs = await makeTempDirs('save-update-');
    try {
      const existing = structuredClone(validConfig);
      existing.tiers.fast.model = 'custom/fast-model';
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(existing, null, 2));
      await saveMode('deep', dirs.projectDir);
      const raw = await readFile(join(dirs.projectDir, 'tiers.json'), 'utf8');
      const parsed = JSON.parse(raw) as RouterConfig;
      expect(parsed.mode).toBe('deep');
      expect(parsed.tiers.fast.model).toBe('custom/fast-model');
      expect(parsed.modes.deep.defaultTier).toBe('heavy');
    } finally {
      await dirs.cleanup();
    }
  });

  it('rejects an invalid mode name', async () => {
    const dirs = await makeTempDirs('save-invalid-');
    try {
      await expect(saveMode('invalid-mode', dirs.projectDir)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await dirs.cleanup();
    }
  });
});

describe('getActiveTiers', () => {
  it('returns the default tier and tier configs for the current mode', () => {
    const normal = getActiveTiers({ ...validConfig, mode: 'normal' });
    expect(normal.defaultTier).toBe('medium');
    expect(normal.tiers.medium.model).toBe('anthropic/claude-sonnet-4-5');

    const budget = getActiveTiers({ ...validConfig, mode: 'budget' });
    expect(budget.defaultTier).toBe('fast');
  });

  it('throws ConfigError for an unknown mode', () => {
    expect(() => getActiveTiers({ ...validConfig, mode: 'unknown' })).toThrow(ConfigError);
  });
});

describe('validateConfig', () => {
  it('does not throw for a valid config', () => {
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it('throws when a mode is missing defaultTier', () => {
    const bad = structuredClone(validConfig);
    bad.modes.normal = { description: 'No default tier' } as any;
    expect(() => validateConfig(bad)).toThrow(ConfigError);
  });

  it('throws when a defaultTier does not exist in tiers', () => {
    const bad = structuredClone(validConfig);
    bad.modes.normal.defaultTier = 'nonexistent';
    expect(() => validateConfig(bad)).toThrow(ConfigError);
  });
});
