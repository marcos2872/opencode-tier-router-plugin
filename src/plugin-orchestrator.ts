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
import { FileLogger } from './utils/logger.js';
import { TRIVIAL_TASK_MAX_LENGTH, SESSION_TTL_MS } from './constants.js';

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
  private sessionActivity = new Map<string, number>();
  private enabled = true;
  private log: FileLogger;

  constructor(
    private readonly ctx: { directory: string; client?: unknown },
    private readonly config: RouterConfig,
  ) {
    this.log = new FileLogger();
  }

  private cleanupSessions(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    const stale: string[] = [];
    for (const [id, ts] of this.sessionActivity) {
      if (ts < cutoff) stale.push(id);
    }
    for (const id of stale) {
      this.sessionActivity.delete(id);
      this.subagentSessions.delete(id);
      this.subagentTierMap.delete(id);
      this.hardBlockedSessions.delete(id);
      this.hardBlockReasons.delete(id);
      this.preferredTierSessions.delete(id);
      this.selectionSourceSessions.delete(id);
      this.capTracker.cleanup(id);
    }
  }

  private touchSession(sessionID: string): void {
    this.sessionActivity.set(sessionID, Date.now());
  }

  private async loadConfig(): Promise<RouterConfig> {
    return this.config;
  }

  async handleConfig(input: Config): Promise<void> {
    try {
      const cfg = await this.loadConfig();

      try {
        assertEnforcement(cfg);
        this.log.info('Enforcement validation passed');
      } catch (enforcementErr) {
        this.log.error('CRITICAL: Enforcement validation failed. Config is invalid for 100% delegation.');
        this.log.warn(reportEnforcement(cfg));
      }

      input.agent = input.agent ?? {};
      for (const tier of TIER_NAMES) {
        const model = cfg.tiers[tier]?.model;
        if (!model || !/^[^/]+\/[^/]+$/.test(model)) {
          this.log.warn(`skipping invalid tier model for @${tier}: ${model}`);
          continue;
        }
        input.agent[tier] = {
          ...(input.agent[tier] ?? {}),
          model,
          mode: 'subagent',
          permission: {
            read: 'allow',
            edit: 'allow',
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            bash: 'allow',
            webfetch: 'allow',
            websearch: 'allow',
            todowrite: 'allow',
            doom_loop: 'allow',
            external_directory: 'allow',
            lsp: 'allow',
            skill: 'allow',
            question: 'allow',
            task: 'allow',
          } as Record<string, string>,
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

      // Only force permission overrides in hard-block mode.
      // In advisory mode, default permissions (native tools auto-allowed) are fine.
      // task is intentionally excluded — it is the delegation mechanism itself
      // and must remain available for the model to call.
      if (cfg.enforcement.mode === 'hard-block') {
        const ALL_TOOLS = [
          'read', 'edit', 'glob', 'grep', 'list', 'bash',
          'webfetch', 'websearch', 'todowrite', 'doom_loop',
          'external_directory', 'lsp', 'skill', 'question',
        ];
        input.permission ??= {};
        for (const tool of ALL_TOOLS) {
          (input.permission as Record<string, unknown>)[tool] = 'ask';
        }
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
      this.log.warn('config hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleChatMessage(
    input: { agent?: string; sessionID: string; parts?: Array<{ type?: string; text?: string }> },
    output: { message: { summary?: { title?: string; body?: string } }; parts?: unknown[] },
  ): Promise<void> {
    try {
      this.cleanupSessions();
      this.touchSession(input.sessionID);

      // Normalize agent name: the runtime may send "@fast" or "fast"
      const agent = input.agent?.replace(/^@/, '');
      const isTier = !!(agent && isTierName(agent));
      this.log.info('chat.message', { sessionID: input.sessionID, agent: input.agent, normalized: agent, isTier });

      if (isTier) {
        this.subagentSessions.add(input.sessionID);
        this.subagentTierMap.set(input.sessionID, agent);
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
        return;
      }

      this.subagentSessions.delete(input.sessionID);
      this.subagentTierMap.delete(input.sessionID);

      if (!this.enabled) {
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
        return;
      }

      const cfg = await this.loadConfig();
      const mappedTier = agent ? AGENT_TIER_MAP[agent] : undefined;

      const inputText = messageText((input.parts ?? []) as Array<{ type?: string; text?: string }>);
      const summaryText = `${output.message.summary?.title ?? ''}\n${output.message.summary?.body ?? ''}`.trim();
      const fallbackOutput = messageText((output.parts ?? []) as Array<{ type?: string; text?: string }>);
      const text = inputText || summaryText || fallbackOutput;
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

      this.log.info('classify', { sessionID: input.sessionID, desiredTier, action: 'HARD-BLOCK' });
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
      this.log.warn('chat.message hook failed:', err instanceof Error ? err.message : String(err));
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
      this.log.warn('system.transform hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handlePermissionAsk(input: { sessionID?: string; type?: string }, output: { status?: string }): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!input.sessionID) return;

      this.log.info('permission.ask', { sessionID: input.sessionID, type: input.type, isSubagent: this.subagentSessions.has(input.sessionID), isHardBlocked: this.hardBlockedSessions.has(input.sessionID) });

      // Subagent → auto-allow without showing the permission dialog.
      // The event hook used to respond with 'once' AFTER the dialog appeared,
      // which caused a visual flash. Running before the dialog, this hook
      // prevents it entirely.
      if (this.subagentSessions.has(input.sessionID)) {
        output.status = 'allow';
        return;
      }

      // Normal (non-hard-blocked) session → let the runtime fall through
      // to the event hook for the standard dialog flow.
      const tier = this.hardBlockedSessions.get(input.sessionID);
      if (!tier) return;

      // Hard-blocked → deny before the dialog appears, so the user
      // never sees a permission popup that will be rejected.
      output.status = 'deny';
    } catch (err) {
      this.log.warn('permission.ask hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> {
    try {
      if (!this.enabled) return;
      const event = input.event;

      // The internal bus publishes "permission.asked"; the SDK type uses "permission.updated".
      if (event.type !== 'permission.asked' && event.type !== 'permission.updated') return;

      const props = event.properties as {
        id?: string;
        sessionID?: string;
        type?: string;
        permission?: string;
      } | undefined;
      if (!props?.sessionID) return;

      const client = (this.ctx as { client?: { postSessionIdPermissionsPermissionId?: Function } }).client;
      if (!client?.postSessionIdPermissionsPermissionId || !props.id) {
        this.log.warn('cannot reply:', { hasClient: !!client, hasMethod: !!(client as any)?.postSessionIdPermissionsPermissionId, hasId: !!props.id, sessionID: props.sessionID });
        return;
      }

      const tier = this.hardBlockedSessions.get(props.sessionID);
      this.log.info('event', { sessionID: props.sessionID, permission: props.permission, tier: tier ?? null, isSubagent: this.subagentSessions.has(props.sessionID) });
      if (tier) {
        // Show a visible toast notification so the user understands the block,
        // even if the permission dialog is hidden behind the input prompt.
        void (client as any).tui?.showToast({
          body: {
            message: `[Router] Tool blocked. Delegate to @${tier} via task().`,
            variant: 'error',
            duration: 8000,
          },
        });
        // Hard-blocked main session → reject, so the model receives a
        // DeniedError/RejectedError and learns it must delegate via task().
        await client.postSessionIdPermissionsPermissionId({
          path: { id: props.sessionID, permissionID: props.id },
          body: { response: 'reject' },
        });
      } else {
        this.log.info('auto-allow', { sessionID: props.sessionID, permission: props.permission });
        // Non-hard-blocked session (subagent OR normal conversation) →
        // auto-allow with "once" so the tool executes without user dialog.
        // Using "once" (not "always") avoids adding permanent global allow rules
        // that would persist across sessions.
        await client.postSessionIdPermissionsPermissionId({
          path: { id: props.sessionID, permissionID: props.id },
          body: { response: 'once' },
        });
      }
    } catch (err) {
      this.log.warn('event hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // Map of tools → contextual hint. The router (which has the delegation
  // protocol in its system prompt) reads "Router:" and chooses to delegate.
  // Subagents ignore the hint because they are not in "router mode".
  private readonly BLOCKED_TOOL_HINTS: Record<string, string> = {
    grep: 'Router: delegate search to @fast.',
    glob: 'Router: delegate file search to @fast.',
    read: 'Router: delegate reading to @fast.',
    list: 'Router: delegate listing to @fast.',
    bash: 'Router: delegate command execution to @medium or @heavy.',
    edit: 'Router: delegate edits to @medium.',
    write: 'Router: delegate writes to @medium.',
    webfetch: 'Router: delegate web fetch to @medium.',
    websearch: 'Router: delegate web search to @medium.',
  };

  async handleToolDefinition(
    input: { toolID: string },
    output: { description?: string; parameters?: unknown },
  ): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!output.description) return;
      const hint = this.BLOCKED_TOOL_HINTS[input.toolID];
      if (!hint) return; // leave unblocked tools (e.g. task) untouched
      output.description = `${output.description}\n[Router: ${hint}]`;
    } catch (err) {
      this.log.warn('tool.definition hook failed:', err instanceof Error ? err.message : String(err));
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
      this.log.warn('tool.execute.after hook failed:', err instanceof Error ? err.message : String(err));
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
      this.log.warn('text.complete hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleCommandExecuteBefore(
    input: { sessionID: string; command: string; arguments: string },
    output: { parts?: TextPart[] },
  ): Promise<void> {
    try {
      this.cleanupSessions();
      this.touchSession(input.sessionID);
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
      this.log.warn('command.execute.before hook failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
