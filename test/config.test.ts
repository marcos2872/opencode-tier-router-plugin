import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  getActiveTiers,
  loadTiers,
  resolveTiersPath,
  saveMode,
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
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

describe('resolveTiersPath', () => {
  it('prioriza tiers.json do projeto sobre o global', async () => {
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

  it('usa tiers.json global quando o projeto não tem arquivo', async () => {
    const dirs = await makeTempDirs('resolve-global-');
    try {
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify(validConfig));

      const resolved = await resolveTiersPath(dirs.projectDir, dirs.globalDir);

      expect(resolved).toBe(join(dirs.globalDir, 'tiers.json'));
    } finally {
      await dirs.cleanup();
    }
  });

  it('retorna caminho do projeto quando os arquivos não existem', async () => {
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
  it('carrega config do projeto quando existe', async () => {
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

  it('carrega config global quando o projeto não tem arquivo', async () => {
    const dirs = await makeTempDirs('load-global-');
    try {
      await writeFile(join(dirs.globalDir, 'tiers.json'), JSON.stringify({ ...validConfig, mode: 'budget' }));

      const cfg = await loadTiers(dirs.projectDir, dirs.globalDir);

      expect(cfg.mode).toBe('budget');
    } finally {
      await dirs.cleanup();
    }
  });

  it('lança ConfigError para JSON malformatado', async () => {
    const dirs = await makeTempDirs('load-malformed-');
    try {
      await writeFile(join(dirs.projectDir, 'tiers.json'), '{ not json');

      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toThrow(
        `Malformed JSON in tiers config at ${join(dirs.projectDir, 'tiers.json')}`,
      );
    } finally {
      await dirs.cleanup();
    }
  });

  it('lança ConfigError quando modelo de tier está ausente', async () => {
    const dirs = await makeTempDirs('load-missing-model-');
    try {
      const bad = structuredClone(validConfig);
      bad.tiers.fast.model = '';
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));

      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toThrow(
        new ConfigError('tier "fast" is missing a model'),
      );
    } finally {
      await dirs.cleanup();
    }
  });

  it('lança ConfigError quando costRatio não é positivo', async () => {
    const dirs = await makeTempDirs('load-cost-ratio-');
    try {
      const bad = structuredClone(validConfig);
      bad.tiers.medium.costRatio = 0;
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));

      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toThrow(
        new ConfigError('tier "medium" costRatio must be a positive number'),
      );
    } finally {
      await dirs.cleanup();
    }
  });

  it('lança ConfigError quando taskPatterns está vazio', async () => {
    const dirs = await makeTempDirs('load-patterns-');
    try {
      const bad = structuredClone(validConfig);
      bad.taskPatterns.fast = [];
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));

      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toThrow(
        new ConfigError('taskPatterns for tier "fast" must be a non-empty array'),
      );
    } finally {
      await dirs.cleanup();
    }
  });

  it('lança ConfigError quando modo ativo é desconhecido', async () => {
    const dirs = await makeTempDirs('load-mode-');
    try {
      const bad = { ...validConfig, mode: 'unknown' };
      await writeFile(join(dirs.projectDir, 'tiers.json'), JSON.stringify(bad));

      await expect(loadTiers(dirs.projectDir, dirs.globalDir)).rejects.toThrow(
        new ConfigError('active mode "unknown" is not defined in modes'),
      );
    } finally {
      await dirs.cleanup();
    }
  });
});

describe('saveMode', () => {
  it('cria tiers.json com padrões quando o arquivo não existe', async () => {
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

  it('atualiza somente o modo e preserva campos existentes', async () => {
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

  it('rejeita nome de modo inválido', async () => {
    const dirs = await makeTempDirs('save-invalid-');
    try {
      await expect(saveMode('invalid-mode', dirs.projectDir)).rejects.toThrow(
        new ConfigError('unknown mode "invalid-mode"'),
      );
    } finally {
      await dirs.cleanup();
    }
  });
});

describe('getActiveTiers', () => {
  it('retorna tier padrão e configurações para o modo atual', () => {
    const normal = getActiveTiers({ ...validConfig, mode: 'normal' });

    expect(normal.defaultTier).toBe('medium');
    expect(normal.tiers.medium.model).toBe('anthropic/claude-sonnet-4-5');

    const budget = getActiveTiers({ ...validConfig, mode: 'budget' });

    expect(budget.defaultTier).toBe('fast');
  });

  it('lança ConfigError para modo desconhecido', () => {
    expect(() => getActiveTiers({ ...validConfig, mode: 'unknown' })).toThrow(
      new ConfigError('unknown mode "unknown"'),
    );
  });
});

describe('validateConfig', () => {
  it('não lança erro para config válida', () => {
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it('lança ConfigError quando modo não tem defaultTier', () => {
    const bad = structuredClone(validConfig);
    bad.modes.normal = { description: 'Sem tier padrão' } as RouterConfig['modes']['normal'];

    expect(() => validateConfig(bad)).toThrow(new ConfigError('mode "normal" is missing defaultTier'));
  });

  it('lança ConfigError quando defaultTier não existe em tiers', () => {
    const bad = structuredClone(validConfig);
    bad.modes.normal.defaultTier = 'nonexistent';

    expect(() => validateConfig(bad)).toThrow(
      new ConfigError('mode "normal" defaultTier "nonexistent" does not exist in tiers'),
    );
  });
});
