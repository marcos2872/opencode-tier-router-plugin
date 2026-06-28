import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, PluginInput } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import tierRouterPlugin from '../src/index.js';
import {
  HARD_BLOCK_DELEGATION_MESSAGE,
  HARD_BLOCK_DENIED_TOOLS,
  OPENCODE_ROUTER_HARD_BLOCKED,
  OPENCODE_ROUTER_MODE,
  OPENCODE_ROUTER_TIER,
} from '../src/constants.js';
import { FileLogger } from '../src/utils/logger.js';

function makeClient(
  appLog: ReturnType<typeof vi.fn> = vi.fn(async () => true),
  tuiShowToast: ReturnType<typeof vi.fn> = vi.fn(async () => true),
  postPermission: ReturnType<typeof vi.fn> = vi.fn(async () => true),
): PluginInput['client'] {
  return {
    app: { log: appLog },
    tui: { showToast: tuiShowToast },
    postSessionIdPermissionsPermissionId: postPermission,
  } as unknown as PluginInput['client'];
}

function makeCtx(directory: string, client: PluginInput['client'] = {} as PluginInput['client']): PluginInput {
  return {
    directory,
    worktree: directory,
    client,
    project: {} as unknown as PluginInput['project'],
    experimental_workspace: { register: () => {} },
    serverUrl: new URL('http://localhost'),
    $: {} as unknown as PluginInput['$'],
  };
}

function textOf(parts: TextPart[] | undefined): string {
  return parts?.map((p) => p.text).join('\n') ?? '';
}

async function classifyHardBlocked(
  plugin: Awaited<ReturnType<typeof tierRouterPlugin>>,
  sessionID: string,
): Promise<void> {
  await plugin['chat.message']?.(
    { sessionID, agent: 'build' },
    {
      message: {
        role: 'user',
        id: `m-${sessionID}`,
        sessionID,
        time: { created: 0 },
        agent: 'build',
        model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
        summary: { title: 'review architecture thoroughly', diffs: [] },
      },
      parts: [{ type: 'text', text: 'review architecture thoroughly' } as unknown as TextPart],
    },
  );
}

async function setupProject(): Promise<string> {
  const dir = join('/tmp', `tier-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeTiers(dir: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const base: Record<string, unknown> = {
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
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
    await rm(join(process.cwd(), 'src', 'router-debug.log'), { force: true });
  });

  it('registra inicializacao do plugin em client.app.log quando disponivel', async () => {
    const appLog = vi.fn(async () => true);

    await tierRouterPlugin(makeCtx(projectDir, makeClient(appLog)));

    expect(appLog).toHaveBeenCalledTimes(1);
    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: 'opencode-tier-router',
        level: 'info',
        message: 'Plugin initialized',
        extra: { directory: projectDir },
      },
      query: { directory: projectDir },
    });
  });

  it('ignora app logging silenciosamente quando client.app.log nao esta disponivel', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir, {} as unknown as PluginInput['client']));
    const config: Config = { agent: {} };

    await plugin.config?.(config);

    expect(config.agent?.fast).toBeDefined();
  });

  it('registra selecao de tier e eventos de hard-block em client.app.log', async () => {
    const appLog = vi.fn(async () => true);
    const plugin = await tierRouterPlugin(makeCtx(projectDir, makeClient(appLog)));

    await plugin['chat.message']?.(
      { sessionID: 'main-hard', agent: 'build' },
      {
        message: {
          role: 'user',
          id: 'm-hard-log',
          sessionID: 'main-hard',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
          summary: { title: 'review architecture thoroughly', diffs: [] },
        },
        parts: [{ type: 'text', text: 'review architecture thoroughly' } as unknown as TextPart],
      },
    );

    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: 'opencode-tier-router',
        level: 'info',
        message: 'Tier selected',
        extra: { tier: 'heavy', source: 'keyword' },
      },
      query: { directory: projectDir },
    });

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p-hard-log',
        type: 'bash',
        sessionID: 'main-hard',
        messageID: 'm-hard-log',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      },
      askOut,
    );
    expect(askOut.status).toBe('deny');
    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: 'opencode-tier-router',
        level: 'info',
        message: 'Hard-block triggered',
        extra: { sessionID: 'main-hard', tier: 'heavy' },
      },
      query: { directory: projectDir },
    });
  });

  it('registra falhas de hook em client.app.log', async () => {
    const appLog = vi.fn(async () => true);
    const plugin = await tierRouterPlugin(makeCtx(projectDir, makeClient(appLog)));

    await plugin['experimental.text.complete']?.({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, {
      text: undefined,
    } as unknown as { text: string });

    expect(appLog).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          level: 'error',
          message: 'Hook failed',
          extra: expect.objectContaining({
            hook: 'experimental.text.complete',
            error: expect.any(String),
          }),
        }),
        query: { directory: projectDir },
      }),
    );
  });

  it('usa pads silenciosamente quando tiers.json esta ausente', async () => {
    const emptyDir = join('/tmp', `tier-router-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    const warnSpy = vi.spyOn(console, 'warn');

    try {
      const plugin = await tierRouterPlugin(makeCtx(emptyDir));
      const config: Config = { agent: {} };
      await plugin.config?.(config);

      expect(config.agent?.fast).toBeDefined();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('registra subagentes fast, medium e heavy a partir de tiers.json', async () => {
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

  it('ignora tiers com strings de modelo invalidas', async () => {
    await writeTiers(projectDir, {
      tiers: {
        fast: { model: 'invalid-no-slash', costRatio: 1, cap: 8 },
        medium: { model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 },
        heavy: { model: 'also-invalid/', costRatio: 20, cap: 20 },
      },
    });

    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const config: Config = { agent: {} };
    await plugin.config?.(config);

    expect(config.agent?.fast).toBeUndefined();
    expect(config.agent?.heavy).toBeUndefined();
    expect(config.agent?.medium).toMatchObject({
      model: 'github-copilot/gpt-5.3-codex',
      mode: 'subagent',
    });
  });

  it('/tiers exibe modo ativo e configuracao de tier', async () => {
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

  it('rastreia tier preferido dinamicamente por intencao', async () => {
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

  it('/budget lista modos com ativo destacado', async () => {
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

  it('/budget <mode> persiste modo em tiers.json', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/budget', sessionID: 's1', arguments: 'budget' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    expect(textOf(output.parts)).toContain('Switched to budget mode');
    const raw = await import('node:fs/promises').then((m) => m.readFile(join(projectDir, 'tiers.json'), 'utf8'));
    const saved = JSON.parse(raw);

    expect(saved.mode).toBe('budget');
  });

  it('/budget quality atualiza modo ativo e usa padrão quality no roteamento', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['command.execute.before']?.(
      { command: '/budget', sessionID: 's-quality', arguments: 'quality' },
      { parts: [] as TextPart[] },
    );

    await plugin['chat.message']?.(
      {
        sessionID: 's-quality',
        message: {
          role: 'user',
          id: 'm-quality',
          sessionID: 's-quality',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'github-copilot', modelID: 'gpt-5.3-codex' },
        },
        parts: [
          {
            id: 'p-quality',
            sessionID: 's-quality',
            messageID: 'm-quality',
            type: 'text',
            text: 'melhore a navegacao',
          },
        ],
      } as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[0],
      {
        message: {
          role: 'user',
          id: 'm-quality',
          sessionID: 's-quality',
          time: { created: 0 },
        },
        parts: [],
      } as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[1],
    );

    const tiersOut = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.({ command: '/tiers', sessionID: 's-quality', arguments: '' }, tiersOut);
    const text = textOf(tiersOut.parts);

    expect(text).toContain('Mode: quality');
    expect(text).toContain('Preferred tier (current session): @medium via fallback-default');
  });

  it('/budget com modo invalido mostra modos disponiveis e mantem atual', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const input = { command: '/budget', sessionID: 's1', arguments: 'unknown' };
    const output = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(input, output);

    const text = textOf(output.parts);
    expect(text).toContain('Unknown mode');
    expect(text).toContain('normal, budget, quality, deep');
  });

  it('/router off desabilita roteamento e reporta status', async () => {
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

  it('expoe ferramenta customizada router_status com estado atual do roteador', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const routerStatusTool = (
      plugin as unknown as { tool?: { router_status?: { description?: string; execute: () => Promise<string> } } }
    ).tool?.router_status;

    expect(routerStatusTool?.description).toContain('router_status');
    const raw = await routerStatusTool?.execute();
    const state = JSON.parse(raw ?? '{}');

    expect(state).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: 'normal',
        hardBlockCount: 0,
        tiers: {
          fast: expect.objectContaining({ model: 'github-copilot/claude-haiku-4.5', costRatio: 1, cap: 8 }),
          medium: expect.objectContaining({ model: 'github-copilot/gpt-5.3-codex', costRatio: 5, cap: 12 }),
          heavy: expect.objectContaining({ model: 'github-copilot/claude-sonnet-4.5', costRatio: 20, cap: 20 }),
        },
      }),
    );
  });

  it('cria modelos de comando esperados para opencode', async () => {
    const commands = await readdir(join(process.cwd(), '.opencode', 'commands'));
    const tools = await readdir(join(process.cwd(), '.opencode', 'tools'));

    expect(commands).toEqual(expect.arrayContaining(['tiers.md', 'budget.md', 'router.md']));
    expect(tools).toEqual(expect.arrayContaining(['router_status.js']));
  });

  it('router_status conta sessoes hard-blockadas', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await classifyHardBlocked(plugin, 'status-hard');
    const routerStatusTool = (
      plugin as unknown as { tool?: { router_status?: { description?: string; execute: () => Promise<string> } } }
    ).tool?.router_status;

    const raw = await routerStatusTool?.execute();
    const state = JSON.parse(raw ?? '{}');

    expect(state.hardBlockCount).toBe(1);
  });

  it('/router on reabilita roteamento', async () => {
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

  it('intercepta /router off via chat.message', async () => {
    await writeTiers(projectDir, { enforcement: { mode: 'hard-block', trivialDirectAllowed: true } });
    const plugin = await tierRouterPlugin(makeCtx(projectDir));

    const output = {
      message: {},
      parts: [] as unknown[],
    };
    await plugin['chat.message']?.(
      {
        sessionID: 'test-cmd',
        message: {
          role: 'user',
          id: 'm-test-cmd',
          sessionID: 'test-cmd',
          time: { created: 0 },
        },
        parts: [{ type: 'text', text: '/router off' }],
      } as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[0],
      output as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[1],
    );

    expect(textOf(output.parts as TextPart[])).toContain('disabled');
    expect((plugin as unknown as { enabled: boolean }).enabled).toBe(false);

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p-test-cmd',
        type: 'read',
        sessionID: 'test-cmd',
        messageID: 'm-test-cmd',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      } as unknown as Parameters<NonNullable<(typeof plugin)['permission.ask']>>[0],
      askOut,
    );
    expect(askOut.status).toBe('allow');
  });

  it('replaya respostas de command.execute.before quando chat.message nao tem partes', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));

    const offCommand = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(
      { command: '/router', sessionID: 'test-pending-off', arguments: 'off' },
      offCommand,
    );

    const offChat = { message: {}, parts: [] as unknown[] };
    await plugin['chat.message']?.(
      { sessionID: 'test-pending-off', parts: [] } as unknown as Parameters<
        NonNullable<(typeof plugin)['chat.message']>
      >[0],
      offChat as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[1],
    );
    expect(textOf(offChat.parts as TextPart[])).toBe('Tier router disabled.');

    const onCommand = { parts: [] as TextPart[] };
    await plugin['command.execute.before']?.(
      { command: '/router', sessionID: 'test-pending-on', arguments: 'on' },
      onCommand,
    );

    const onChat = { message: {}, parts: [] as unknown[] };
    await plugin['chat.message']?.(
      { sessionID: 'test-pending-on', parts: [] } as unknown as Parameters<
        NonNullable<(typeof plugin)['chat.message']>
      >[0],
      onChat as unknown as Parameters<NonNullable<(typeof plugin)['chat.message']>>[1],
    );
    expect(textOf(onChat.parts as TextPart[])).toBe('Tier router enabled.');
    expect(textOf(offChat.parts as TextPart[])).not.toContain('/router off');
    expect((plugin as unknown as { enabled: boolean }).enabled).toBe(true);
  });

  it('quando roteador esta off, hooks system, caps e narration sao nop', async () => {
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

  it('anexa banner de narracao em experimental.text.complete', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const output = { text: 'Still writing the auth function' };
    await plugin['experimental.text.complete']?.({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, output);

    expect(output.text).toContain('[⚠ narration detected:');
    expect(output.text).toContain('Still writing the auth function');
  });

  it('nao anexa banner de narracao para texto limpo', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const output = { text: 'The implementation is complete and tested.' };
    await plugin['experimental.text.complete']?.({ sessionID: 's1', messageID: 'm1', partID: 'p1' }, output);

    expect(output.text).not.toContain('[⚠ narration detected:');
  });

  it('anexa banner de cap para resultados de ferramenta somente leitura em sessoes de subagentes', async () => {
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

  it('injeta variaveis de ambiente do router em shells de subagentes', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'sub-shell-env', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm-sub-shell-env',
          sessionID: 'sub-shell-env',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
        },
        parts: [],
      },
    );

    const subagentOut = {};
    await plugin['shell.env']?.(
      {
        sessionID: 'sub-shell-env',
        env: { PATH: '/bin' },
        conversationSettings: { systemPrompt: 'subagent profile' },
      } as unknown as Parameters<NonNullable<(typeof plugin)['shell.env']>>[0],
      subagentOut as unknown as Parameters<NonNullable<(typeof plugin)['shell.env']>>[1],
    );

    expect(subagentOut).toEqual({
      env: {
        PATH: '/bin',
        [OPENCODE_ROUTER_TIER]: 'fast',
        [OPENCODE_ROUTER_MODE]: 'normal',
        [OPENCODE_ROUTER_HARD_BLOCKED]: 'false',
      },
    });

    const mainOut = { env: { PATH: '/bin', [OPENCODE_ROUTER_MODE]: 'legacy' } };
    await plugin['shell.env']?.(
      {
        env: { PATH: '/bin', [OPENCODE_ROUTER_MODE]: 'legacy' },
        conversationSettings: { systemPrompt: 'main profile' },
      } as unknown as Parameters<NonNullable<(typeof plugin)['shell.env']>>[0],
      mainOut as unknown as Parameters<NonNullable<(typeof plugin)['shell.env']>>[1],
    );

    expect(mainOut).toEqual({
      env: { PATH: '/bin', [OPENCODE_ROUTER_MODE]: 'legacy' },
    });
  });

  it('preserva estado de roteamento no contexto de compactacao', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await classifyHardBlocked(plugin, 'main-compaction');

    const output = {
      context: {
        router: { preferredTier: 'old', selectionSource: 'old', kept: 'output-router-state' },
      },
    };
    await plugin['experimental.session.compacting']?.(
      {
        sessionID: 'main-compaction',
        context: { router: { preferredTier: 'old', selectionSource: 'old' } },
      } as unknown as Parameters<NonNullable<(typeof plugin)['experimental.session.compacting']>>[0],
      output as unknown as Parameters<NonNullable<(typeof plugin)['experimental.session.compacting']>>[1],
    );

    expect(output).toEqual({
      context: {
        router: {
          preferredTier: 'heavy',
          selectionSource: 'keyword',
          hardBlockedTier: 'heavy',
          hardBlockReason:
            'Current agent maps to @medium, but this request was classified as @heavy. Redirect to @heavy.',
          kept: 'output-router-state',
        },
      },
    });
  });

  it('registra estado de roteamento de subagentes no FileLogger', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    const infoSpy = vi.spyOn(FileLogger.prototype, 'info');

    await plugin['chat.message']?.(
      { sessionID: 'sub-log', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm-sub-log',
          sessionID: 'sub-log',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
        },
        parts: [],
      },
    );

    expect(infoSpy).toHaveBeenCalledWith('subagent routing state registered', {
      sessionID: 'sub-log',
      tier: 'fast',
    });
  });

  it('hard-block nega permissao direta de ferramentas em solicitacoes nao triviais', async () => {
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
    expect(systemOut.system.join('\n')).not.toContain('Task Delegation Reference');
  });

  it('hard-block retorna contrato exato para cada ferramenta nativa bloqueada', async () => {
    for (const tool of HARD_BLOCK_DENIED_TOOLS) {
      const plugin = await tierRouterPlugin(makeCtx(projectDir));
      await classifyHardBlocked(plugin, `main-${tool}`);

      const toolOut = { allow: true, message: 'allowed', args: { path: 'src/index.ts' } };
      await plugin['tool.execute.before']?.({ sessionID: `main-${tool}`, tool, callID: `call-${tool}` }, toolOut);

      expect(toolOut).toEqual({ allow: false, message: HARD_BLOCK_DELEGATION_MESSAGE });
    }
  });

  it('notifica TUI quando hard-block bloqueia ferramenta antes da execucao', async () => {
    const tuiShowToast = vi.fn(async () => true);
    const plugin = await tierRouterPlugin(makeCtx(projectDir, makeClient(undefined, tuiShowToast)));
    await classifyHardBlocked(plugin, 'main-tool-toast');

    const toolOut = { args: { path: 'src/index.ts' } };
    await plugin['tool.execute.before']?.(
      { sessionID: 'main-tool-toast', tool: 'read', callID: 'call-read-toast' },
      toolOut,
    );

    expect(toolOut).toEqual({ allow: false, message: HARD_BLOCK_DELEGATION_MESSAGE });
    expect(tuiShowToast).toHaveBeenCalledWith({
      body: {
        title: 'Acao bloqueada',
        message: 'Delegue para @heavy.',
        variant: 'warning',
        duration: 8000,
      },
    });
  });

  it('ignora notificacao de hard-block quando tui nao esta disponivel', async () => {
    const plugin = await tierRouterPlugin(
      makeCtx(projectDir, { app: { log: vi.fn(async () => true) } } as unknown as PluginInput['client']),
    );
    await classifyHardBlocked(plugin, 'main-tool-toast-missing-tui');

    const toolOut = { args: { path: 'src/index.ts' } };
    await plugin['tool.execute.before']?.(
      { sessionID: 'main-tool-toast-missing-tui', tool: 'read', callID: 'call-read-missing-tui' },
      toolOut,
    );

    expect(toolOut).toEqual({ allow: false, message: HARD_BLOCK_DELEGATION_MESSAGE });
  });

  it('hard-block deixa ferramentas nao bloqueadas antes da execucao para sessoes principais', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await classifyHardBlocked(plugin, 'main-task-before');

    const toolOut = { args: { task: 'write docs', sessionID: 'main-task-before' } };
    await plugin['tool.execute.before']?.(
      { sessionID: 'main-task-before', tool: 'task', callID: 'call-task' },
      toolOut,
    );

    expect(toolOut).toEqual({ args: { task: 'write docs', sessionID: 'main-task-before' } });
  });

  it('hard-block retorna allow para sessoes de subagentes antes da execucao', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'sub-tool-before', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm-sub-tool-before',
          sessionID: 'sub-tool-before',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
        },
        parts: [],
      },
    );

    const toolOut = { allow: true, message: 'allowed', args: { path: 'src/index.ts' } };
    await plugin['tool.execute.before']?.(
      { sessionID: 'sub-tool-before', tool: 'read', callID: 'call-read-sub' },
      toolOut,
    );

    expect(toolOut).toEqual({ allow: true, args: { path: 'src/index.ts' } });
  });

  it('normaliza caminhos de ferramentas de subagentes e registra auditoria', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'sub-tool-normalize', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm-sub-tool-normalize',
          sessionID: 'sub-tool-normalize',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
        },
        parts: [],
      },
    );

    const toolOut = {
      allow: true,
      message: 'allowed',
      args: { path: 'src/index.ts   \n', nested: { filePath: 'README.md\t   ' } },
    };
    const infoSpy = vi.spyOn(FileLogger.prototype, 'info');
    await plugin['tool.execute.before']?.(
      {
        sessionID: 'sub-tool-normalize',
        tool: 'read',
        callID: 'call-read-normalize',
        args: toolOut.args,
      } as unknown as Parameters<NonNullable<(typeof plugin)['tool.execute.before']>>[0],
      toolOut,
    );

    expect(toolOut).toEqual({
      allow: true,
      args: { path: 'src/index.ts', nested: { filePath: 'README.md' } },
    });
    expect(infoSpy).toHaveBeenCalledWith('Subagent tool args normalized', {
      sessionID: 'sub-tool-normalize',
      callID: 'call-read-normalize',
      tool: 'read',
      changedPaths: ['path', 'nested.filePath'],
    });
  });

  it('hard-block registra tentativas de ferramentas bloqueadas no FileLogger', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await classifyHardBlocked(plugin, 'main-tool-audit');

    const toolOut = { args: { path: 'src/index.ts' } };
    const infoSpy = vi.spyOn(FileLogger.prototype, 'info');
    await plugin['tool.execute.before']?.(
      { sessionID: 'main-tool-audit', tool: 'read', callID: 'call-read-audit' },
      toolOut,
    );

    expect(toolOut).toEqual({ allow: false, message: HARD_BLOCK_DELEGATION_MESSAGE });

    expect(infoSpy).toHaveBeenCalledWith('Denied tool blocked before execution', {
      sessionID: 'main-tool-audit',
      callID: 'call-read-audit',
      tool: 'read',
    });
  });

  it('hard-block nega permissao direta de ferramentas em sessoes build mapeadas', async () => {
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

  it('auto-permite permissao quando roteador esta desabilitado', async () => {
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

    await plugin['command.execute.before']?.(
      { command: '/router', sessionID: 'main-build', arguments: 'off' },
      { parts: [] },
    );

    const disabledAskOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p-build-disabled',
        type: 'bash',
        sessionID: 'main-build',
        messageID: 'm-build',
        title: 'run command',
        metadata: {},
        time: { created: 0 },
      },
      disabledAskOut,
    );

    expect(disabledAskOut.status).toBe('allow');
  });

  it('permite fast trivial para sessoes principais nao hard-blockadas quando configurado', async () => {
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

    expect(askOut.status).toBe('allow');
  });

  it('permite task e custom permissoes para sessoes principais hard-blockadas', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await classifyHardBlocked(plugin, 'main-permission-allow');

    for (const permission of ['task', 'skill'] as const) {
      const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
      await plugin['permission.ask']?.(
        {
          id: `p-${permission}`,
          type: permission,
          sessionID: 'main-permission-allow',
          messageID: 'm-permission-allow',
          title: permission,
          metadata: {},
          time: { created: 0 },
        },
        askOut,
      );

      expect(askOut.status).toBe('allow');
    }
  });

  it('nega permissao task para sessoes de subagentes', async () => {
    const plugin = await tierRouterPlugin(makeCtx(projectDir));
    await plugin['chat.message']?.(
      { sessionID: 'sub-permission-task', agent: 'fast' },
      {
        message: {
          role: 'user',
          id: 'm-sub-permission-task',
          sessionID: 'sub-permission-task',
          time: { created: 0 },
          agent: 'fast',
          model: { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
        },
        parts: [],
      },
    );

    const askOut: { status: 'ask' | 'deny' | 'allow' } = { status: 'ask' };
    await plugin['permission.ask']?.(
      {
        id: 'p-sub-task',
        type: 'task',
        sessionID: 'sub-permission-task',
        messageID: 'm-sub-permission-task',
        title: 'delegate',
        metadata: {},
        time: { created: 0 },
      },
      askOut,
    );

    expect(askOut.status).toBe('deny');
  });

  it('eventos rejeitam permissao negada e permitem permissao autorizada', async () => {
    const postPermission = vi.fn(async () => true);
    const plugin = await tierRouterPlugin(makeCtx(projectDir, makeClient(undefined, undefined, postPermission)));

    await classifyHardBlocked(plugin, 'main-event-native');
    await plugin['event']?.({
      event: {
        type: 'permission.asked',
        properties: {
          id: 'p-native',
          sessionID: 'main-event-native',
          type: 'bash',
          permission: 'bash',
        },
      },
    } as unknown as Parameters<NonNullable<(typeof plugin)['event']>>[0]);
    expect(postPermission).toHaveBeenLastCalledWith({
      path: { id: 'main-event-native', permissionID: 'p-native' },
      body: { response: 'reject' },
    });

    const postPermissionAllow = vi.fn(async () => true);
    const pluginAllow = await tierRouterPlugin(
      makeCtx(projectDir, makeClient(undefined, undefined, postPermissionAllow)),
    );
    await classifyHardBlocked(pluginAllow, 'main-event-task');
    await pluginAllow['event']?.({
      event: {
        type: 'permission.asked',
        properties: {
          id: 'p-task',
          sessionID: 'main-event-task',
          type: 'task',
          permission: 'task',
        },
      },
    } as unknown as Parameters<NonNullable<(typeof pluginAllow)['event']>>[0]);
    expect(postPermissionAllow).toHaveBeenLastCalledWith({
      path: { id: 'main-event-task', permissionID: 'p-task' },
      body: { response: 'once' },
    });
  });
});
