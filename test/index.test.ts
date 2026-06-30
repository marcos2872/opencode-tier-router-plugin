import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, PluginInput } from '@opencode-ai/plugin';
import tierRouterPlugin from '../src/index.js';

function makeClient(): PluginInput['client'] {
  return {} as PluginInput['client'];
}

function makeCtx(directory: string, client: PluginInput['client'] = makeClient()): PluginInput {
  return {
    directory,
    worktree: directory,
    client,
    project: {} as PluginInput['project'],
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL('http://localhost'),
    $: {} as PluginInput['$'],
  };
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

function writeTiers(path: string, overrides: Record<string, unknown> = {}): void {
  const config: Record<string, unknown> = {
    mode: 'balanced',
    agentName: 'router',
    agentModel: 'opencode/big-pickle',
    routerPrompt: 'custom router prompt',
    tiers: {
      fast: {
        model: 'opencode/big-pickle',
        systemPrompt: 'custom fast prompt',
        costRatio: 1,
        cap: 8,
      },
      medium: {
        model: 'llama.cpp/Nex-N2-mini',
        systemPrompt: 'custom medium prompt',
        costRatio: 5,
        cap: 12,
      },
      heavy: {
        model: 'llama.cpp/Nex-N2-mini',
        systemPrompt: 'custom heavy prompt',
        costRatio: 20,
        cap: 20,
      },
    },
    modes: {
      balanced: { description: 'Router decides the best tier', defaultTier: 'medium' },
      budget: { description: 'Router prefers @fast', defaultTier: 'fast' },
      quality: { description: 'Router prefers @medium or @heavy', defaultTier: 'medium' },
    },
    taskPatterns: { fast: ['find'] },
    enforcement: { mode: 'hard-block', trivialDirectAllowed: false },
    routing: { strategy: 'llm', selectorModel: 'x/y', selectorTimeoutMs: 1, selectorMaxTokens: 1 },
  };

  writeFileSync(path, JSON.stringify({ ...config, ...overrides }, null, 2));
}

describe('tierRouterPlugin', () => {
  let projectDir: string;

  beforeEach(async () => {
    const temp = await tempDir('router-agent-index-');
    projectDir = temp.dir;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it('registers only the config hook', async () => {
    writeTiers(join(projectDir, 'tiers.json'));
    const plugin = (await tierRouterPlugin(makeCtx(projectDir))) as { config?: (input: Config) => Promise<Config> };

    expect(Object.keys(plugin)).toEqual(['config']);
  });

  it('creates Router with task allowed and native tools denied', async () => {
    writeTiers(join(projectDir, 'tiers.json'));
    const plugin = (await tierRouterPlugin(makeCtx(projectDir))) as { config?: (input: Config) => Promise<Config> };
    const input: Config = { agent: {} };

    await plugin.config?.(input);

    expect(input.agent?.router).toMatchObject({
      model: 'opencode/big-pickle',
      systemPrompt: 'custom router prompt',
      permission: {
        task: { allow: ['@fast', '@medium', '@heavy'] },
        read: 'deny',
        glob: 'deny',
        grep: 'deny',
        list: 'deny',
        bash: 'deny',
        edit: 'deny',
        write: 'deny',
        webfetch: 'deny',
        websearch: 'deny',
        skill: 'allow',
        question: 'deny',
        tool: 'deny',
      },
    });
  });

  it('creates @fast, @medium and @heavy subagents with allow permissions and prompts', async () => {
    writeTiers(join(projectDir, 'tiers.json'));
    const plugin = (await tierRouterPlugin(makeCtx(projectDir))) as { config?: (input: Config) => Promise<Config> };
    const input: Config = { agent: {} };

    await plugin.config?.(input);

    expect(input.agent?.fast).toMatchObject({
      model: 'opencode/big-pickle',
      mode: 'subagent',
      systemPrompt: 'custom fast prompt',
      permission: expect.objectContaining({ read: 'allow', grep: 'allow', bash: 'allow', tool: 'allow' }),
    });
    expect(input.agent?.medium).toMatchObject({
      model: 'llama.cpp/Nex-N2-mini',
      mode: 'subagent',
      systemPrompt: 'custom medium prompt',
      permission: expect.objectContaining({ read: 'allow', grep: 'allow', bash: 'allow', tool: 'allow' }),
    });
    expect(input.agent?.heavy).toMatchObject({
      model: 'llama.cpp/Nex-N2-mini',
      mode: 'subagent',
      systemPrompt: 'custom heavy prompt',
      permission: expect.objectContaining({ read: 'allow', grep: 'allow', bash: 'allow', tool: 'allow' }),
    });
  });

  it('falls back to default prompts when tier prompts are omitted', async () => {
    writeTiers(join(projectDir, 'tiers.json'), {
      tiers: {
        fast: { model: 'opencode/big-pickle' },
        medium: { model: 'llama.cpp/Nex-N2-mini' },
        heavy: { model: 'llama.cpp/Nex-N2-mini' },
      },
    });
    const plugin = (await tierRouterPlugin(makeCtx(projectDir))) as { config?: (input: Config) => Promise<Config> };
    const input: Config = { agent: {} };

    await plugin.config?.(input);

    expect(input.agent?.fast?.systemPrompt).toContain('Você é @fast');
    expect(input.agent?.medium?.systemPrompt).toContain('Você é @medium');
    expect(input.agent?.heavy?.systemPrompt).toContain('Você é @heavy');
  });

  it('logs invalid tiers.json errors without creating agents', async () => {
    writeTiers(join(projectDir, 'tiers.json'), { modes: {} });
    const plugin = (await tierRouterPlugin(makeCtx(projectDir))) as { config?: (input: Config) => Promise<Config> };
    const input: Config = { agent: {} };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await plugin.config?.(input);

    expect(input.agent).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith('[tier-router] config error:', expect.any(Error));
  });
});
