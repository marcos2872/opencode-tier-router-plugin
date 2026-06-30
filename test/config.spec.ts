import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type RouterConfig } from '../src/config.js';

type RawConfig = Partial<RouterConfig> & {
  taskPatterns?: unknown;
  enforcement?: unknown;
  routing?: unknown;
};

async function expectConfigError(path: string, message: string): Promise<void> {
  try {
    await loadConfig(path);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).message).toBe(message);
  }
}

function writeConfig(path: string, config: RawConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2));
}

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const validConfig: RawConfig = {
  mode: 'balanced',
  agentName: 'router-agent',
  agentModel: 'custom/router-model',
  routerPrompt: 'custom router prompt',
  tiers: {
    fast: {
      model: 'custom/fast-model',
      systemPrompt: 'custom fast prompt',
      costRatio: 1,
      cap: 8,
    },
    medium: {
      model: 'custom/medium-model',
      systemPrompt: 'custom medium prompt',
      costRatio: 5,
      cap: 12,
    },
    heavy: {
      model: 'custom/heavy-model',
      systemPrompt: 'custom heavy prompt',
      costRatio: 20,
      cap: 20,
    },
  },
  modes: {
    balanced: { description: 'Balanced', defaultTier: 'medium' },
    budget: { description: 'Budget', defaultTier: 'fast' },
    quality: { description: 'Quality', defaultTier: 'medium' },
  },
  taskPatterns: { fast: ['find'] },
  enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
  routing: { strategy: 'llm', selectorModel: 'x/y', selectorTimeoutMs: 1, selectorMaxTokens: 1 },
};

describe('loadConfig', () => {
  it('loads and normalizes a valid tiers.json with optional router fields', async () => {
    const temp = await tempDir('router-agent-valid-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, validConfig);

      const cfg = loadConfig(path);

      expect(cfg.mode).toBe('balanced');
      expect(cfg.agentName).toBe('router-agent');
      expect(cfg.agentModel).toBe('custom/router-model');
      expect(cfg.routerPrompt).toBe('custom router prompt');
      expect(cfg.tiers.fast.systemPrompt).toBe('custom fast prompt');
      expect(cfg.tiers.medium.systemPrompt).toBe('custom medium prompt');
      expect(cfg.tiers.heavy.systemPrompt).toBe('custom heavy prompt');
      expect(cfg.tiers.fast.model).toBe('custom/fast-model');
    } finally {
      await temp.cleanup();
    }
  });

  it('applies default router and subagent prompts when optional fields are omitted', async () => {
    const temp = await tempDir('router-agent-defaults-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, {
        mode: 'balanced',
        tiers: {
          fast: { model: 'custom/fast-model' },
          medium: { model: 'custom/medium-model' },
          heavy: { model: 'custom/heavy-model' },
        },
        modes: {
          balanced: { description: 'Balanced', defaultTier: 'medium' },
          budget: { description: 'Budget', defaultTier: 'fast' },
          quality: { description: 'Quality', defaultTier: 'medium' },
        },
      });

      const cfg = loadConfig(path);

      expect(cfg.agentName).toBe('router');
      expect(cfg.agentModel).toBe('opencode/big-pickle');
      expect(cfg.routerPrompt).toContain('Você é o Router');
      expect(cfg.tiers.fast.systemPrompt).toContain('Você é @fast');
      expect(cfg.tiers.medium.systemPrompt).toContain('Você é @medium');
      expect(cfg.tiers.heavy.systemPrompt).toContain('Você é @heavy');
    } finally {
      await temp.cleanup();
    }
  });

  it('creates a default tiers.json when no file exists', async () => {
    const temp = await tempDir('router-agent-create-');
    try {
      const path = join(temp.dir, 'tiers.json');

      const cfg = loadConfig(path);

      expect(cfg.mode).toBe('balanced');
      expect(cfg.agentName).toBe('router');
      expect(cfg.agentModel).toBe('opencode/big-pickle');
      const saved = await readFile(path, 'utf8');
      expect(JSON.parse(saved).mode).toBe('balanced');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when tiers are missing', async () => {
    const temp = await tempDir('router-agent-missing-tiers-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { mode: 'balanced', modes: validConfig.modes });

      await expectConfigError(path, 'tiers must be an object');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when modes are missing', async () => {
    const temp = await tempDir('router-agent-missing-modes-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { mode: 'balanced', tiers: validConfig.tiers });

      await expectConfigError(path, 'modes must be an object');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when the active mode is unknown', async () => {
    const temp = await tempDir('router-agent-unknown-mode-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { ...validConfig, mode: 'unknown' });

      await expectConfigError(path, 'active mode "unknown" is not defined in modes');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when a defaultTier does not exist in tiers', async () => {
    const temp = await tempDir('router-agent-invalid-default-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { ...validConfig, modes: { balanced: { description: 'Balanced', defaultTier: 'missing' } } });

      await expectConfigError(path, 'mode "balanced" defaultTier "missing" does not exist in tiers');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when agentName is empty', async () => {
    const temp = await tempDir('router-agent-empty-agent-name-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { ...validConfig, agentName: '' });

      await expectConfigError(path, 'agentName must not be empty');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when agentModel is empty', async () => {
    const temp = await tempDir('router-agent-empty-agent-model-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { ...validConfig, agentModel: '' });

      await expectConfigError(path, 'agentModel must not be empty');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when routerPrompt is not a string', async () => {
    const temp = await tempDir('router-agent-bad-router-prompt-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, { ...validConfig, routerPrompt: 123 } as unknown as RawConfig);

      await expectConfigError(path, 'routerPrompt must be a string');
    } finally {
      await temp.cleanup();
    }
  });

  it('throws when a tier systemPrompt is not a string', async () => {
    const temp = await tempDir('router-agent-bad-tier-prompt-');
    try {
      const path = join(temp.dir, 'tiers.json');
      writeConfig(path, {
        ...validConfig,
        tiers: {
          ...(validConfig.tiers as RouterConfig['tiers'] | undefined),
          fast: {
            ...(validConfig.tiers?.fast as RouterConfig['tiers']['fast']),
            systemPrompt: 123 as never,
          },
        },
      } as unknown as RawConfig);

      await expectConfigError(path, 'tier "fast" systemPrompt must be a string');
    } finally {
      await temp.cleanup();
    }
  });
});
