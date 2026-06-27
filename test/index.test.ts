import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PluginInput, Config } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import tierRouterPlugin from '../src/index.js';

function makeCtx(directory: string): PluginInput {
  return {
    directory,
    worktree: directory,
    client: {} as unknown as PluginInput['client'],
    project: {} as unknown as PluginInput['project'],
    experimental_workspace: { register: () => {} },
    serverUrl: new URL('http://localhost'),
    $: {} as unknown as PluginInput['$'],
  };
}

function textOf(parts: TextPart[] | undefined): string {
  return parts?.map((p) => p.text).join('\n') ?? '';
}

async function setupProject(): Promise<string> {
  const dir = join('/tmp', `tier-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeTiers(dir: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const base = {
    mode: 'normal',
    tiers: {
      fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 },
      medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
      heavy: { model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 },
    },
    modes: {
      normal: { description: 'Balanced', defaultTier: 'medium' },
      budget: { description: 'Budget', defaultTier: 'fast' },
      quality: { description: 'Quality', defaultTier: 'medium' },
      deep: { description: 'Deep', defaultTier: 'heavy' },
    },
    taskPatterns: {
      fast: ['find', 'grep'],
      medium: ['refactor', 'implement'],
      heavy: ['design', 'debug'],
    },
    routing: {
      strategy: 'keyword',
      selectorModel: 'github-copilot/claude-haiku-4.5',
      selectorTimeoutMs: 1200,
      selectorMaxTokens: 16,
    },
  };
  await writeFile(join(dir, 'tiers.json'), JSON.stringify({ ...base, ...overrides }, null, 2));
}

describe('tierRouterPlugin', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProject();
    await writeTiers(projectDir);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('uses defaults silently when tiers.json is missing', async () => {
    const emptyDir = join('/tmp', `tier-router-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      const plugin = await tierRouterPlugin(makeCtx(emptyDir));
      const config: Config = { agent: {} };
      await plugin.config?.(config);
      expect(config.agent?.fast).toBeDefined();
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('registers fast/medium/heavy subagent agents from tiers.json', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const config: Config = { agent: {} };
    await plugin.config?.(config);

    expect(config.agent?.fast).toMatchObject({
      model: 'github-copilot/claude-haiku-4.5',
      mode: 'subagent',
    });
    expect(config.agent?.medium).toMatchObject({
      model: 'github-copilot/gpt-5.3-codex',
      mode: 'subagent',
    });
    expect(config.agent?.heavy).toMatchObject({
      model: 'github-copilot/claude-sonnet-4.5',
      mode: 'subagent',
    });
    expect(config.agent?.explore).toMatchObject({
      model: 'github-copilot/claude-haiku-4.5',
    });
    expect(config.agent?.build).toMatchObject({
      model: 'github-copilot/gpt-5.3-codex',
    });
  });

  it('skips tiers with invalid model strings and logs a warning', async () => {
    await writeTiers(projectDir, {
      tiers: {
        fast: { model: 'invalid-no-slash', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'also-invalid/', costRatio: 20, cap: 20 },
      },
    });

    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const config: Config = { agent: {} };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      await plugin.config?.(config);
    } finally {
      console.warn = originalWarn;
    }

    expect(config.agent?.fast).toBeUndefined();
    expect(config.agent?.heavy).toBeUndefined();
    expect(config.agent?.medium).toMatchObject({
      model: 'github-copilot/gpt-5.3-codex',
      mode: 'subagent',
    });
    expect(warnings.some((w) => w.includes('@fast'))).toBe(true);
    expect(warnings.some((w) => w.includes('@heavy'))).toBe(true);
  });

  it('/tiers displays active mode and tier configuration', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/tiers', sessionID: 's1', arguments: '' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    const text = textOf(output.parts);
    expect(text).toContain('Mode: normal');
    expect(text).toContain('Routing strategy: keyword');
    expect(text).toContain('Agent mapping: explore->@fast, build->@medium, general->@heavy, plan->@heavy');
    expect(text).toContain('Preferred tier (current session): none yet');
    expect(text).toContain('@fast:');
    expect(text).toContain('github-copilot/claude-haiku-4.5');
  });

  it('tracks preferred tier dynamically by intent, overriding mapped build tier when needed', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 's-dyn', agent: 'build' },
      {
        message: {
          role: 'user',
          id: 'm-dyn',
          sessionID: 's-dyn',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
          summary: { title: 'find authentication code', diffs: [] },
        },
        parts: [{ type: 'text', text: 'find authentication code' } as unknown as TextPart],
      },
    );

    const tiersOut = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.({ command: '/tiers', sessionID: 's-dyn', arguments: '' }, tiersOut);
    const text = textOf(tiersOut.parts);
    expect(text).toContain('Preferred tier (current session): @fast via keyword');
  });

  it('/budget lists modes with active one highlighted', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/budget', sessionID: 's1', arguments: '' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    const text = textOf(output.parts);
    expect(text).toContain('→ normal:');
    expect(text).toContain('budget:');
    expect(text).toContain('quality:');
    expect(text).toContain('deep:');
  });

  it('/budget <mode> persists mode to tiers.json', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/budget', sessionID: 's1', arguments: 'budget' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    expect(textOf(output.parts)).toContain('Switched to budget mode');
    const raw = await import('node:fs/promises').then((m) => m.readFile(join(projectDir, 'tiers.json'), 'utf8'));
    const saved = JSON.parse(raw);
    expect(saved.mode).toBe('budget');
  });

  it('/budget with invalid mode shows available modes and keeps current', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/budget', sessionID: 's1', arguments: 'unknown' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    const text = textOf(output.parts);
    expect(text).toContain('Unknown mode');
    expect(text).toContain('normal, budget, quality, deep');
  });

  it('/router off disables routing and reports status', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const off = { command: '/router', sessionID: 's1', arguments: 'off' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(off, output);
    expect(textOf(output.parts)).toContain('Tier router disabled');

    const status = { command: '/router', sessionID: 's1', arguments: '' };
    const statusOut = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(status, statusOut);
    expect(textOf(statusOut.parts)).toContain('off');
  });

  it('/router on re-enables routing', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['command.execute.before']?.({ command: '/router', sessionID: 's1', arguments: 'off' }, { parts: [] });

    const on = { command: '/router', sessionID: 's1', arguments: 'on' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(on, output);
    expect(textOf(output.parts)).toContain('Tier router enabled');

    const systemOut = { system: [] as string[] };
    await plugin['experimental.chat.system.transform']?.(
      {
        sessionID: 's1',
        model: {} as unknown as Parameters<
          NonNullable<(typeof plugin)['experimental.chat.system.transform']>
        >[0]['model'],
      },
      systemOut,
    );
    expect(systemOut.system.length).toBeGreaterThan(0);
  });

  it('when router is off, system transform, caps, and narration hooks are no-ops', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['command.execute.before']?.({ command: '/router', sessionID: 's1', arguments: 'off' }, { parts: [] });

    const systemOut = { system: [] as string[] };
    await plugin['experimental.chat.system.transform']?.(
      {
        sessionID: 's2',
        model: {} as unknown as Parameters<
          NonNullable<(typeof plugin)['experimental.chat.system.transform']>
        >[0]['model'],
      },
      systemOut,
    );
    expect(systemOut.system).toHaveLength(0);

    const toolOut = { title: 't', output: 'result', metadata: {} };
    await plugin['tool.execute.after']?.(
      { sessionID: 's2', tool: 'read', callID: 'c1', args: { path: '/tmp/x' } },
      toolOut,
    );
    expect(toolOut.output).toBe('result');

    const textOut = { text: 'Still writing the function' };
    await plugin['experimental.text.complete']?.({ sessionID: 's2', messageID: 'm1', partID: 'p1' }, textOut);
    expect(textOut.text).toBe('Still writing the function');
  });

  it('appends narration banner on experimental.text.complete', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const output = { text: 'Still writing the auth function' };
    await plugin['experimental.text.complete']?.({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, output);
    expect(output.text).toContain('[⚠ narration detected:');
    expect(output.text).toContain('Still writing the auth function');
  });

  it('does not append narration banner for clean text', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const output = { text: 'The implementation is complete and tested.' };
    await plugin['experimental.text.complete']?.({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, output);
    expect(output.text).not.toContain('[⚠ narration detected:');
  });

  it('appends cap banner to read-only tool results in subagent sessions', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const config: Config = { agent: {} };
    await plugin.config?.(config);
    await plugin['chat.message']?.(
      { sessionID: 'sub1', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm1',
          sessionID: 'sub1',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'p', modelID: 'm' },
        },
        parts: [],
      },
    );

    const out = { title: 'read', output: 'file content', metadata: {} };
    for (let i = 0; i < 4; i++) {
      await plugin['tool.execute.after']?.(
        { sessionID: 'sub1', tool: 'read', callID: `c${i}`, args: { path: `/tmp/f${i}` } },
        out,
      );
    }

    expect(out.output).toContain('[cap: 4/8]');
  });

  it('hard-block denies direct tool permissions for non-trivial classified requests', async () => {
    await writeTiers(projectDir, {
      enforcement: {
        mode: 'hard-block',
        trivialDirectAllowed: true,
      },
    });

    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'main-hard' },
      {
        message: {
          role: 'user',
          id: 'm-hard',
          sessionID: 'main-hard',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
          summary: { title: 'debug authentication flow thoroughly', diffs: [] },
        },
        parts: [{ type: 'text', text: 'debug authentication flow thoroughly' } as unknown as TextPart],
      },
    );

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p1',
        type: 'bash',
        sessionID: 'main-hard',
        messageID: 'm-hard',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      },
      askOut,
    );

    expect(askOut.status).toBe('deny');

    const systemOut = { system: [] as string[] };
    await plugin['experimental.chat.system.transform']?.(
      {
        sessionID: 'main-hard',
        model: {} as unknown as Parameters<
          NonNullable<(typeof plugin)['experimental.chat.system.transform']>
        >[0]['model'],
      },
      systemOut,
    );
    expect(systemOut.system.join('\n')).toContain('HARD-BLOCK');
  });

  it('hard-block denies direct tool permissions for mapped build agent sessions', async () => {
    await writeTiers(projectDir, {
      enforcement: {
        mode: 'hard-block',
        trivialDirectAllowed: true,
      },
    });

    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'main-build', agent: 'build' },
      {
        message: {
          role: 'user',
          id: 'm-build',
          sessionID: 'main-build',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
        },
        parts: [{ type: 'text', text: 'busque auth no projeto' } as unknown as TextPart],
      },
    );

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p-build',
        type: 'bash',
        sessionID: 'main-build',
        messageID: 'm-build',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      },
      askOut,
    );

    expect(askOut.status).toBe('deny');
  });

  it('hard-block still allows trivial fast requests when configured', async () => {
    await writeTiers(projectDir, {
      enforcement: {
        mode: 'hard-block',
        trivialDirectAllowed: true,
      },
    });

    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'main-trivial' },
      {
        message: {
          role: 'user',
          id: 'm-trivial',
          sessionID: 'main-trivial',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
          summary: { title: 'find login function', diffs: [] },
        },
        parts: [{ type: 'text', text: 'find login function' } as unknown as TextPart],
      },
    );

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p2',
        type: 'bash',
        sessionID: 'main-trivial',
        messageID: 'm-trivial',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      },
      askOut,
    );

    expect(askOut.status).toBe('ask');
  });
});
