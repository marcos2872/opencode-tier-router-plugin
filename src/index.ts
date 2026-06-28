/**
 * opencode-tier-router-plugin — Ponto de entrada do plugin
 *
 * Função wrapper fina que cria o plugin e delega toda a orquestração de hooks
 * para o PluginOrchestrator. Mantida intencionalmente pequena para cumprir SRP
 * — toda a lógica de negócio está em módulos dedicados.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Config } from '@opencode-ai/plugin';
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

  return {
    get enabled(): boolean {
      return orchestrator.enabledState;
    },
    config: (input: Config) => orchestrator.handleConfig(input),
    'chat.message': (input: any, output: any) => orchestrator.handleChatMessage(input, output),
    'experimental.chat.system.transform': (input: any, output: any) =>
      orchestrator.handleSystemTransform(input, output),
    event: (input: any) => orchestrator.handleEvent(input),
    'permission.ask': (input: any, output: any) => orchestrator.handlePermissionAsk(input, output),
    'tool.definition': (input: any, output: any) => orchestrator.handleToolDefinition(input, output),
    'tool.execute.after': (input: any, output: any) => orchestrator.handleToolExecuteAfter(input, output),
    'experimental.text.complete': (input: any, output: any) => orchestrator.handleTextComplete(input, output),
    'command.execute.before': (input: any, output: any) => orchestrator.handleCommandExecuteBefore(input, output),
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
