/**
 * PluginOrchestrator — Camada de orquestração de hooks
 *
 * Responsabilidade: Conectar todos os hooks do plugin e gerenciar estado compartilhado.
 *
 * Estado gerenciado aqui:
 * - capTracker, subagentSessions, hardBlockedSessions
 * - preferredTierSessions, selectionSourceSessions
 */

import type { Config } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import { type RouterConfig, saveMode } from './router/config.js';
import {
  buildDelegationProtocol,
  buildRoutingHint,
  buildHardBlockMessage,
  buildNarrationAnnotation,
} from './prompts.js';
import { selectTierByStrategy, type SelectionSource } from './router/selector.js';
import { createCapTracker } from './router/caps.js';
import { detectNarration } from './narration.js';
import { assertEnforcement, reportEnforcement } from './router/enforcement-validator.js';
import { TRIVIAL_TASK_MAX_LENGTH } from './constants.js';

const TIER_NAMES = ['fast', 'medium', 'heavy'] as const;
type TierName = (typeof TIER_NAMES)[number];
const AGENT_TIER_MAP: Record<string, TierName> = {
  explore: 'fast',
  build: 'medium',
  general: 'heavy',
  plan: 'heavy',
};

const TRIVIAL_HINT_RE =
  /\b(find|grep|search|where|locate|list|show|read|explore|buscar|procurar|ler|listar|mostrar)\b/i;
const MULTI_STEP_HINT_RE =
  /\b(and then|depois|em seguida|follow-up|implement|refactor|design|architecture|debug|analyze|implementar|refatorar|arquitetura|depurar|analisar)\b/i;

function isTierName(name: string): name is TierName {
  return (TIER_NAMES as readonly string[]).includes(name);
}

function isTrivialFastTask(text: string): boolean {
  const compact = text.toLowerCase().trim();
  if (compact.length === 0 || compact.length > TRIVIAL_TASK_MAX_LENGTH) return false;
  return TRIVIAL_HINT_RE.test(compact) && !MULTI_STEP_HINT_RE.test(compact);
}

function messageText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

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

export class PluginOrchestrator {
  private capTracker = createCapTracker();
  private subagentSessions = new Set<string>();
  private subagentTierMap = new Map<string, TierName>();
  private hardBlockedSessions = new Map<string, TierName>();
  private hardBlockReasons = new Map<string, string>();
  private preferredTierSessions = new Map<string, TierName>();
  private selectionSourceSessions = new Map<string, SelectionSource>();
  private enabled = true;

  constructor(
    private readonly ctx: { directory: string; client?: unknown },
    private readonly config: RouterConfig,
  ) {}

  private async loadConfig(): Promise<RouterConfig> {
    return this.config;
  }

  async handleConfig(input: Config): Promise<void> {
    try {
      const cfg = await this.loadConfig();

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
    } catch (err) {
      console.warn('[opencode-tier-router] config hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleChatMessage(
    input: { agent?: string; sessionID: string },
    output: { message: { summary?: { title?: string; body?: string } }; parts?: unknown[] },
  ): Promise<void> {
    try {
      if (input.agent && isTierName(input.agent)) {
        this.subagentSessions.add(input.sessionID);
        this.subagentTierMap.set(input.sessionID, input.agent);
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
      console.warn(
        '[opencode-tier-router] chat.message hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

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
        output.system.push(buildRoutingHint(preferredTier, source));
      }

      const tier = input.sessionID ? this.hardBlockedSessions.get(input.sessionID) : undefined;
      if (cfg.enforcement.mode === 'hard-block' && tier) {
        const reason = input.sessionID ? this.hardBlockReasons.get(input.sessionID) : undefined;
        output.system.push(buildHardBlockMessage(tier, reason));
      }
    } catch (err) {
      console.warn(
        '[opencode-tier-router] system.transform hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

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
      console.warn(
        '[opencode-tier-router] permission.ask hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async handleToolExecuteAfter(
    input: { sessionID?: string; tool: string; args?: Record<string, unknown> },
    output: { output?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!input.sessionID) return;

      if (this.subagentSessions.has(input.sessionID)) {
        this.capTracker.record(input.sessionID, input.tool, input.args ?? {});
        const banner = this.capTracker.getBanner(input.sessionID, input.tool, input.args ?? {});
        if (banner) {
          output.output = (output.output ?? '') + `\n${banner}`;
        }
      }
    } catch (err) {
      console.warn(
        '[opencode-tier-router] tool.execute.after hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async handleTextComplete(_input: unknown, output: { text: string }): Promise<void> {
    try {
      if (!this.enabled) return;

      const match = detectNarration(output.text);
      if (match) {
        output.text += buildNarrationAnnotation(match);
      }
    } catch (err) {
      console.warn(
        '[opencode-tier-router] text.complete hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async handleCommandExecuteBefore(
    input: { sessionID: string; command: string; arguments: string },
    output: { parts?: TextPart[] },
  ): Promise<void> {
    try {
      const command = input.command.replace(/^\//, '').toLowerCase();
      const args = input.arguments.trim();

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
      console.warn(
        '[opencode-tier-router] command.execute.before hook failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
