/**
 * opencode-tier-router-plugin — Ponto de entrada do plugin
 *
 * Função wrapper fina que cria o plugin e delega toda a orquestração de hooks
 * para o PluginOrchestrator. Mantida intencionalmente pequena para cumprir SRP
 * — toda a lógica de negócio está em módulos dedicados.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { tool, type Config, type Plugin } from '@opencode-ai/plugin';
import { loadTiers, ConfigError, type RouterConfig } from './router/config.js';
import { PluginOrchestrator } from './plugin-orchestrator.js';
import { FileLogger } from './utils/logger.js';
import {
  DEFAULT_FAST_COST_RATIO,
  DEFAULT_HEAVY_COST_RATIO,
  DEFAULT_HEAVY_TIER_CAP,
  DEFAULT_MEDIUM_COST_RATIO,
  DEFAULT_MEDIUM_TIER_CAP,
  DEFAULT_TIER_CAP,
} from './constants.js';

const FALLBACK_CONFIG: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: { model: 'github-copilot/claude-haiku-4.5', costRatio: DEFAULT_FAST_COST_RATIO, cap: DEFAULT_TIER_CAP },
    medium: {
      model: 'github-copilot/gpt-5.3-codex',
      costRatio: DEFAULT_MEDIUM_COST_RATIO,
      cap: DEFAULT_MEDIUM_TIER_CAP,
    },
    heavy: {
      model: 'github-copilot/claude-sonnet-4.5',
      costRatio: DEFAULT_HEAVY_COST_RATIO,
      cap: DEFAULT_HEAVY_TIER_CAP,
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
    trivialDirectAllowed: false,
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

function globalConfigDir(): string {
  return join(homedir(), '.config', 'opencode');
}

async function loadConfig(projectDir: string): Promise<RouterConfig> {
  try {
    return await loadTiers(projectDir, globalConfigDir());
  } catch (err) {
    if (err instanceof ConfigError && (err as { cause?: NodeJS.ErrnoException }).cause?.code === 'ENOENT') {
      return FALLBACK_CONFIG;
    }
    new FileLogger().warn(
      '[opencode-tier-router] failed to load tiers.json, using defaults:',
      err instanceof Error ? err.message : String(err),
    );
    return FALLBACK_CONFIG;
  }
}

function routerStatusTool(orchestrator: PluginOrchestrator) {
  return tool({
    description: 'router_status returns the current tier router state as JSON.',
    args: {},
    execute: async () => JSON.stringify(orchestrator.getRoutingState(), null, 2),
  });
}

/**
 * Cria o plugin de roteamento de tiers do OpenCode.
 *
 * O plugin conecta configuração, roteamento de mensagens, injeção de prompt do sistema,
 * negação de permissão, detecção de narração e comandos.
 * Todos os hooks rodam com melhor esforço e nunca lançam exceções para a sessão do host.
 */
const tierRouterPlugin: Plugin = async (ctx) => {
  const cfg = await loadConfig(ctx.directory);
  const orchestrator = new PluginOrchestrator(ctx, cfg);
  await orchestrator.logObservable('info', 'Plugin initialized', { directory: ctx.directory });

  return {
    get enabled(): boolean {
      return orchestrator.enabledState;
    },
    tool: {
      router_status: routerStatusTool(orchestrator),
    },
    config: (input: Config) => orchestrator.handleConfig(input),
    'chat.message': (input: unknown, output: unknown) =>
      orchestrator.handleChatMessage(input as never, output as never),
    'experimental.chat.system.transform': (input: unknown, output: unknown) =>
      orchestrator.handleSystemTransform(input as { sessionID?: string }, output as { system?: string[] }),
    event: (input: unknown) =>
      orchestrator.handleEvent(input as { event: { type: string; properties?: Record<string, unknown> } }),
    'permission.ask': (input: unknown, output: unknown) =>
      orchestrator.handlePermissionAsk(input as { sessionID?: string; type?: string }, output as { status?: string }),
    'tool.definition': (input: unknown, output: unknown) =>
      orchestrator.handleToolDefinition(
        input as { toolID: string },
        output as { description?: string; parameters?: unknown },
      ),
    'tool.execute.before': (input: unknown, output: unknown) =>
      orchestrator.handleToolExecuteBefore(
        input as { sessionID?: string; tool: string; callID?: string; args?: Record<string, unknown> },
        output as { allow?: boolean; message?: string; args?: unknown },
      ),
    'tool.execute.after': (input: unknown, output: unknown) =>
      orchestrator.handleToolExecuteAfter(
        input as { sessionID?: string; tool: string; args?: Record<string, unknown> },
        output as { output?: string; metadata?: Record<string, unknown> },
      ),
    'experimental.text.complete': (input: unknown, output: unknown) =>
      orchestrator.handleTextComplete(input, output as { text: string }),
    'command.execute.before': (input: unknown, output: unknown) =>
      orchestrator.handleCommandExecuteBefore(
        input as { sessionID: string; command: string; arguments: string },
        output as never,
      ),
    'shell.env': (input: unknown, output: unknown) => orchestrator.handleShellEnv(input as never, output as never),
    'experimental.session.compacting': (input: unknown, output: unknown) =>
      orchestrator.handleSessionCompacting(input as never, output as never),
  };
};

/**
 * Plugin de roteamento inteligente de tiers OpenCode.
 *
 * Cria e retorna um objeto plugin que conecta todos os hooks do OpenCode
 * (config, chat.message, chat.system.transform, permission.ask,
 * tool.execute.after, experimental.text.complete, command.execute.before)
 * a uma única instância compartilhada de PluginOrchestrator.
 *
 * @returns Objeto plugin no formato esperado pelo runtime OpenCode.
 *
 * @example
 * ```ts
 * import tierRouterPlugin from './index.js';
 * export default tierRouterPlugin;
 * ```
 */
export default tierRouterPlugin;
