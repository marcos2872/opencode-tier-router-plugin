/**
 * PluginOrchestrator — Camada de orquestração de hooks
 *
 * Responsabilidade: Conectar todos os hooks do plugin e gerenciar estado compartilhado.
 * Extraído de index.ts para respeitar SRP (index.ts agora é apenas um wrapper fino).
 *
 * Estado gerenciado aqui:
 * - capTracker, subagentSessions, hardBlockedSessions
 * - preferredTierSessions, selectionSourceSessions
 * - ciclo de vida do TokenTracker
 */

import { join } from 'node:path';
import type { Config } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import { loadTiers, saveMode, type RouterConfig } from './router/config.js';
import { buildDelegationProtocol } from './router/protocol.js';
import { selectTierByStrategy, type SelectionSource } from './router/selector.js';
import { createCapTracker } from './router/caps.js';
import { detectNarration } from './narration.js';
import { assertEnforcement, reportEnforcement } from './router/enforcement-validator.js';
import { TokenTracker } from './router/token-tracker.js';
import { FilesystemStorage } from './router/filesystem-storage.js';
import { DefaultTokenEventParser } from './router/token-event-parser.js';
import { DefaultMetricsAggregator } from './router/metrics-aggregator.js';
import { MarkdownMetricsFormatter } from './router/metrics-formatter.js';
import { executeTokenCommand, isTokenCommand } from './router/token-commands.js';
import {
  COST_DIVISOR,
  DEFAULT_INPUT_COST_PER_1K,
  DEFAULT_OUTPUT_COST_PER_1K,
  TRIVIAL_TASK_MAX_LENGTH,
} from './constants.js';
import { safeJsonParse } from './utils/safe-json.js';

const TIER_NAMES = ['fast', 'medium', 'heavy'] as const;
type TierName = (typeof TIER_NAMES)[number];
const AGENT_TIER_MAP: Record<string, TierName> = {
  explore: 'fast',
  build: 'medium',
  general: 'heavy',
  plan: 'heavy',
};

const TRIVIAL_HINT_RE = /\b(find|grep|search|where|locate|list|show|read|explore|buscar|procurar|ler|listar|mostrar)\b/i;
const MULTI_STEP_HINT_RE = /\b(and then|depois|em seguida|follow-up|implement|refactor|design|architecture|debug|analyze|implementar|refatorar|arquitetura|depurar|analisar)\b/i;

interface ToolExecuteOutput {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  output?: string;
}

/**
 * Restringe uma string ao conjunto de nomes de tier conhecidos.
 */
function isTierName(name: string): name is TierName {
  return (TIER_NAMES as readonly string[]).includes(name);
}

/**
 * Verifica se a saída da ferramenta contém dados de uso ou de resposta.
 */
function isToolOutputWithUsage(out: unknown): out is ToolExecuteOutput {
  return out !== null && typeof out === 'object' && ('usage' in out || 'output' in out);
}

/**
 * Detecta se uma tarefa é rápida e trivial o bastante para permitir execução direta.
 */
function isTrivialFastTask(text: string): boolean {
  const compact = text.toLowerCase().trim();
  if (compact.length === 0 || compact.length > TRIVIAL_TASK_MAX_LENGTH) return false;
  return TRIVIAL_HINT_RE.test(compact) && !MULTI_STEP_HINT_RE.test(compact);
}

/**
 * Extrai texto legível das partes de mensagem do OpenCode.
 */
function messageText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

/**
 * Cria uma parte de saída de comando de texto para hooks de comando do OpenCode.
 */
function makeTextPart(sessionID: string, text: string): TextPart {
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    sessionID,
    messageID: id,
    type: 'text',
    text,
  };
}

/**
 * PluginOrchestrator — Hub central para todos os handlers de hooks do plugin.
 *
 * Encapsula estado compartilhado de sessões, ciclo de vida do TokenTracker e
 * delega para os módulos de roteamento apropriados. Todos os métodos rodam com
 * melhor esforço e nunca lançam exceções para a sessão do host do OpenCode.
 */
export class PluginOrchestrator {
  private capTracker = createCapTracker();
  private subagentSessions = new Set<string>();
  private hardBlockedSessions = new Map<string, TierName>();
  private hardBlockReasons = new Map<string, string>();
  private preferredTierSessions = new Map<string, TierName>();
  private selectionSourceSessions = new Map<string, SelectionSource>();
  private enabled = true;
  private tokenTracker: TokenTracker | null = null;

  constructor(
    private readonly ctx: { directory: string; client?: unknown },
    private readonly config: RouterConfig,
  ) {}

  /**
   * Inicializa o rastreador de tokens para esta instância do plugin.
   */
  async initialize(): Promise<void> {
    try {
      const storage = new FilesystemStorage();
      const parser = new DefaultTokenEventParser();
      const aggregator = new DefaultMetricsAggregator();
      const formatter = new MarkdownMetricsFormatter();
      const storageDir = join(this.ctx.directory, '.opencode', 'token-metrics');
      this.tokenTracker = new TokenTracker(storage, parser, aggregator, formatter, this.config, storageDir);
    } catch (err) {
      console.error('[opencode-tier-router] Failed to initialize token tracker:', err);
    }
  }

  /**
   * Carrega a configuração do roteador para um projeto, usando padrões quando a configuração estiver ausente.
   */
  private async loadConfig(): Promise<RouterConfig> {
    // Provided via constructor from outer context
    return this.config;
  }

  // ─── Hook Handlers ──────────────────────────────────────────

  /**
   * Configura agentes, modos e comandos do OpenCode para roteamento de tiers.
   */
  async handleConfig(input: Config): Promise<void> {
    try {
      const cfg = await this.loadConfig();

      // Validate enforcement rules at initialization
      try {
        assertEnforcement(cfg);
        console.log('[opencode-tier-router] Enforcement validation passed');
      } catch (enforcementErr) {
        console.warn(
          '[opencode-tier-router] CRITICAL: Enforcement validation failed. Config is invalid for 100% delegation.',
        );
        console.warn(reportEnforcement(cfg));
      }

      input.agent = input.agent ?? {};
      for (const tier of TIER_NAMES) {
        const model = cfg.tiers[tier]?.model;
        if (!model || !/^[^/]+\/[^/]+$/.test(model)) {
          console.warn(`[opencode-tier-router] skipping invalid tier model for @${tier}: ${model}`);
          continue;
        }
        input.agent[tier] = {
          ...(input.agent[tier] ?? {}),
          model,
          mode: 'subagent',
          description: `Tier router @${tier} subagent`,
        };
      }

      // Align OpenCode built-in agent names with tier models
      for (const [agentName, tier] of Object.entries(AGENT_TIER_MAP)) {
        const model = cfg.tiers[tier]?.model;
        if (!model || !/^[^/]+\/[^/]+$/.test(model)) continue;
        input.agent[agentName] = {
          ...(input.agent[agentName] ?? {}),
          model,
          description: `Tier router mapped ${agentName} -> @${tier}`,
        };
      }

      input.command = input.command ?? {};
      input.command.tiers = {
        template: '/tiers',
        description: 'Show active tier configuration',
      };
      input.command.budget = {
        template: '/budget [normal|budget|quality|deep]',
        description: 'Switch routing mode',
      };
      input.command.router = {
        template: '/router [on|off]',
        description: 'Enable or disable tier routing',
      };
      input.command['token-report'] = {
        template: '/token-report <sessionId>',
        description: 'Show real token metrics for a session',
      };
      input.command['token-history'] = {
        template: '/token-history',
        description: 'List all persisted token tracking sessions',
      };
      input.command['token-compare'] = {
        template: '/token-compare <sessionId> <tier>',
        description: 'Estimate cost if session were delegated to different tier',
      };
    } catch (err) {
      console.warn('[opencode-tier-router] config hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Classifica mensagens de chat recebidas e rastreia decisões de roteamento.
   */
  async handleChatMessage(input: { agent?: string; sessionID: string }, output: { message: { summary?: { title?: string; body?: string } }; parts?: unknown[] }): Promise<void> {
    try {
      if (input.agent && isTierName(input.agent)) {
        this.subagentSessions.add(input.sessionID);
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
        return;
      }

      if (!this.enabled) {
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
        return;
      }

      const cfg = await this.loadConfig();
      const mappedTier = input.agent ? AGENT_TIER_MAP[input.agent] : undefined;

      const summaryText = `${output.message.summary?.title ?? ''}\n${output.message.summary?.body ?? ''}`.trim();
      const text = summaryText || messageText((output.parts ?? []) as Array<{ type?: string; text?: string }>);
      const selection = await selectTierByStrategy(text, cfg, this.ctx.client);
      const desiredTier = selection.tier ?? mappedTier ?? null;

      if (desiredTier) {
        this.preferredTierSessions.set(input.sessionID, desiredTier);
        this.selectionSourceSessions.set(input.sessionID, selection.source);
      } else {
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
      }

      if (cfg.enforcement.mode !== 'hard-block') {
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        return;
      }

      if (!desiredTier) {
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        return;
      }

      if (desiredTier === 'fast' && cfg.enforcement.trivialDirectAllowed && isTrivialFastTask(text)) {
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        return;
      }

      this.hardBlockedSessions.set(input.sessionID, desiredTier);
      if (mappedTier && mappedTier !== desiredTier) {
        this.hardBlockReasons.set(
          input.sessionID,
          `Current agent maps to @${mappedTier}, but this request was classified as @${desiredTier}. Redirect to @${desiredTier}.`,
        );
      } else {
        this.hardBlockReasons.set(input.sessionID, `This request requires @${desiredTier}.`);
      }
    } catch (err) {
      console.warn('[opencode-tier-router] chat.message hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Injeta protocolo de delegação e dicas de hard-block no prompt do sistema.
   */
  async handleSystemTransform(input: { sessionID?: string }, output: { system?: string[] }): Promise<void> {
    try {
      if (!this.enabled) return;
      if (input.sessionID && this.subagentSessions.has(input.sessionID)) return;

      const cfg = await this.loadConfig();
      const protocol = buildDelegationProtocol(cfg);
      output.system = output.system ?? [];
      output.system.push(protocol);

      const preferredTier = input.sessionID ? this.preferredTierSessions.get(input.sessionID) : undefined;
      if (preferredTier) {
        const source = input.sessionID ? this.selectionSourceSessions.get(input.sessionID) : undefined;
        output.system.push(
          `Routing hint: Preferred tier for this request is @${preferredTier}${source ? ` (source: ${source})` : ''}. Delegate to @${preferredTier} when not trivial.`,
        );
      }

      const tier = input.sessionID ? this.hardBlockedSessions.get(input.sessionID) : undefined;
      if (cfg.enforcement.mode === 'hard-block' && tier) {
        const reason = input.sessionID ? this.hardBlockReasons.get(input.sessionID) : undefined;
        output.system.push(
          `HARD-BLOCK: This request MUST be delegated to @${tier}. Do not execute tools directly in this session. Attempt delegation now. If direct execution is blocked, immediately delegate to @${tier}.${reason ? ` ${reason}` : ''}`,
        );
      }
    } catch (err) {
      console.warn('[opencode-tier-router] system.transform hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Recusa permissões de execução direta quando um hard-block estiver ativo.
   */
  async handlePermissionAsk(input: { sessionID?: string; type?: string }, output: { status?: string }): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!input.sessionID || this.subagentSessions.has(input.sessionID)) return;

      const tier = this.hardBlockedSessions.get(input.sessionID);
      if (!tier) return;

      if (input.type === 'bash' || input.type === 'edit' || input.type === 'webfetch') {
        output.status = 'deny';
      }
    } catch (err) {
      console.warn('[opencode-tier-router] permission.ask hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Captura uso de tokens após a execução de uma ferramenta e atualiza avisos de limite.
   */
  async handleToolExecuteAfter(input: { sessionID?: string; tool: string; args?: Record<string, unknown> }, output: ToolExecuteOutput & { output?: string }): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!input.sessionID) return;

      // Record cap tracking (existing behavior)
      if (this.subagentSessions.has(input.sessionID)) {
        this.capTracker.record(input.sessionID, input.tool, input.args ?? {});
        const banner = this.capTracker.getBanner(input.sessionID, input.tool, input.args ?? {});
        if (banner) {
          output.output = (output.output ?? '') + `\n${banner}`;
        }
      }

      // Record token usage for tracking
      if (this.tokenTracker) {
        let out: ToolExecuteOutput;
        if (isToolOutputWithUsage(output)) {
          out = output;
        } else {
          out = {};
        }
        let usage = out.usage;
        if (!usage && out.output) {
          const parsed = safeJsonParse<{ usage?: ToolExecuteOutput['usage'] }>(out.output);
          usage = parsed?.usage || usage;
        }

        if (usage) {
          const inputTokens = usage.inputTokens ?? usage.input ?? 0;
          const outputTokens = usage.outputTokens ?? usage.output ?? 0;
          const reasoningTokens = usage.reasoningTokens ?? usage.reasoning ?? 0;
          const cacheRead = usage.cacheReadTokens ?? usage.cache?.read ?? 0;
          const cacheWrite = usage.cacheWriteTokens ?? usage.cache?.write ?? 0;

          const estimatedCost = ((inputTokens * DEFAULT_INPUT_COST_PER_1K) + (outputTokens * DEFAULT_OUTPUT_COST_PER_1K)) / COST_DIVISOR;

          const tier = this.preferredTierSessions.get(input.sessionID);
          const cfg = await this.loadConfig();
          const routing = tier ? {
            tier,
            costRatio: cfg.tiers[tier]?.costRatio ?? 1,
          } : undefined;

          await this.tokenTracker.recordStepFinish({
            type: 'step-finish',
            sessionID: input.sessionID,
            tokens: {
              input: inputTokens,
              output: outputTokens,
              reasoning: reasoningTokens,
              cache: { read: cacheRead, write: cacheWrite },
            },
            cost: estimatedCost,
            timestamp: Date.now(),
          });

          if (routing) {
            await this.tokenTracker.recordRoutingDecision(input.sessionID, routing);
          }
        }
      }
    } catch (err) {
      console.warn('[opencode-tier-router] tool.execute.after hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Detecta narração na saída de conclusão de texto.
   */
  async handleTextComplete(_input: unknown, output: { text: string }): Promise<void> {
    try {
      if (!this.enabled) return;

      const match = detectNarration(output.text);
      if (match) {
        output.text += `\n\n[⚠ narration detected: "${match}"]`;
      }
    } catch (err) {
      console.warn('[opencode-tier-router] text.complete hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Lida com comandos de roteador e rastreamento de tokens antes que eles alcancem o OpenCode.
   */
  async handleCommandExecuteBefore(input: { sessionID: string; command: string; arguments: string }, output: { parts?: TextPart[] }): Promise<void> {
    try {
      const command = input.command.replace(/^\//, '').toLowerCase();
      const args = input.arguments.trim();

      // Handle token tracking commands
      if (isTokenCommand(command) && this.tokenTracker) {
        const result = await executeTokenCommand(this.tokenTracker, command, args);
        if (result !== null) {
          output.parts = [makeTextPart(input.sessionID, result)];
          return;
        }
      }

      if (command === 'router') {
        if (args === 'on') {
          this.enabled = true;
          output.parts = [makeTextPart(input.sessionID, 'Tier router enabled.')];
          return;
        }
        if (args === 'off') {
          this.enabled = false;
          output.parts = [makeTextPart(input.sessionID, 'Tier router disabled.')];
          return;
        }
        output.parts = [makeTextPart(input.sessionID, `Tier router is ${this.enabled ? 'on' : 'off'}.`)];
        return;
      }

      if (command === 'tiers') {
        const cfg = await this.loadConfig();
        const preferredTier = this.preferredTierSessions.get(input.sessionID);
        const source = this.selectionSourceSessions.get(input.sessionID);
        const lines = [
          `Mode: ${cfg.mode} (${cfg.modes[cfg.mode]?.description ?? ''})`,
          `Enforcement: ${cfg.enforcement.mode} (trivial direct allowed: ${cfg.enforcement.trivialDirectAllowed ? 'yes' : 'no'})`,
          `Routing strategy: ${cfg.routing.strategy} (selector model: ${cfg.routing.selectorModel})`,
          `Agent mapping: explore->@fast, build->@medium, general->@heavy, plan->@heavy`,
          `Preferred tier (current session): ${preferredTier ? `@${preferredTier}` : 'none yet'}${source ? ` via ${source}` : ''}`,
          'Tiers:',
        ];
        for (const tier of TIER_NAMES) {
          const t = cfg.tiers[tier];
          lines.push(`  @${tier}: ${t?.model ?? 'n/a'} (cost ${t?.costRatio ?? 'n/a'}x, cap ${t?.cap ?? 'n/a'})`);
        }
        output.parts = [makeTextPart(input.sessionID, lines.join('\n'))];
        return;
      }

      if (command === 'budget') {
        const cfg = await this.loadConfig();

        if (!args) {
          const modeLines = Object.entries(cfg.modes).map(([name, mode]) => {
            const marker = name === cfg.mode ? '→ ' : '  ';
            return `${marker}${name}: ${mode.description ?? ''}`;
          });
          output.parts = [makeTextPart(input.sessionID, `Routing modes:\n${modeLines.join('\n')}`)];
          return;
        }

        const modeName = args.split(/\s+/)[0];
        if (!cfg.modes[modeName]) {
          const available = Object.keys(cfg.modes).join(', ');
          output.parts = [makeTextPart(input.sessionID, `Unknown mode "${modeName}". Available modes: ${available}`)];
          return;
        }

        await saveMode(modeName, this.ctx.directory);
        output.parts = [makeTextPart(input.sessionID, `Switched to ${modeName} mode.`)];
        return;
      }
    } catch (err) {
      console.warn('[opencode-tier-router] command.execute.before hook failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
