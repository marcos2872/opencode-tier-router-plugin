/**
 * opencode-tier-router — Plugin entry point
 *
 * Thin wrapper that creates the plugin and delegates all hook
 * orchestration to PluginOrchestrator. Kept intentionally small
 * for SRP compliance — all business logic lives in dedicated modules.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Config } from '@opencode-ai/plugin';
import { loadTiers, ConfigError, type RouterConfig } from './router/config.js';
import { PluginOrchestrator } from './plugin-orchestrator.js';

const FALLBACK_CONFIG: RouterConfig = {
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
    fast: [
      'find', 'grep', 'search', 'where', 'locate', 'list', 'show', 'read', 'explore',
      'buscar', 'busque', 'busca', 'procurar', 'procure', 'procura', 'ler', 'leia',
      'listar', 'liste', 'mostrar', 'mostre',
    ],
    medium: [
      'refactor', 'implement', 'add', 'write', 'fix', 'update', 'change', 'create',
      'edit', 'rename', 'implementar', 'refatorar', 'adicionar', 'corrigir', 'atualizar',
      'criar', 'editar', 'renomear', 'validar',
    ],
    heavy: [
      'design', 'architecture', 'debug', 'complex', 'explain', 'reason', 'analyze',
      'optimize', 'quality', 'review', 'arquitetura', 'depurar', 'complexo', 'analisar',
      'otimizar', 'qualidade', 'revisar', 'diagnosticar',
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
    console.warn(
      '[opencode-tier-router] failed to load tiers.json, using defaults:',
      err instanceof Error ? err.message : String(err),
    );
    return FALLBACK_CONFIG;
  }
}

/**
 * Create the OpenCode tier routing plugin.
 *
 * The plugin wires configuration, message routing, system prompt injection,
 * permission denial, token tracking, narration detection, and token commands.
 * All hooks run best-effort and never throw into the host session.
 */
const tierRouterPlugin: Plugin = async (ctx) => {
  const cfg = await loadConfig(ctx.directory);
  const orchestrator = new PluginOrchestrator(ctx, cfg);
  await orchestrator.initialize();

  return {
    config: (input: Config) => orchestrator.handleConfig(input),
    'chat.message': (input: any, output: any) => orchestrator.handleChatMessage(input, output),
    'experimental.chat.system.transform': (input: any, output: any) => orchestrator.handleSystemTransform(input, output),
    'permission.ask': (input: any, output: any) => orchestrator.handlePermissionAsk(input, output),
    'tool.execute.after': (input: any, output: any) => orchestrator.handleToolExecuteAfter(input, output),
    'experimental.text.complete': (input: any, output: any) => orchestrator.handleTextComplete(input, output),
    'command.execute.before': (input: any, output: any) => orchestrator.handleCommandExecuteBefore(input, output),
  };
};

export default tierRouterPlugin;
