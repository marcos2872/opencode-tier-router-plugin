/**
 * PluginOrchestrator — Camada de orquestração de hooks
 *
 * Responsabilidade: Conectar todos os hooks do plugin e gerenciar estado compartilhado.
 *
 * Estado gerenciado aqui:
 * - capTracker, subagentSessions, hardBlockedSessions
 * - preferredTierSessions, selectionSourceSessions
 */

import type { Config, PluginInput } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import { type RouterConfig, saveMode } from './router/config.js';
import {
  buildDelegationProtocol,
  buildRoutingHint,
  buildHardBlockMessage,
  buildNarrationAnnotation,
  MODE_EMPHASIS,
} from './prompts.js';
import { selectTierByStrategy, type SelectionSource } from './router/selector.js';
import { createCapTracker } from './router/caps.js';
import { detectNarration } from './narration.js';
import { assertEnforcement, reportEnforcement } from './router/enforcement-validator.js';
import { evaluateSessionPermission, isAllowed } from './router/permissions.js';
import type { RouterState, SessionCompactingInput, SessionCompactingOutput } from './router/types.js';
import { FileLogger } from './utils/logger.js';
import {
  HARD_BLOCK_DELEGATION_MESSAGE,
  HARD_BLOCK_DENIED_TOOLS,
  OPENCODE_ROUTER_HARD_BLOCKED,
  OPENCODE_ROUTER_MODE,
  OPENCODE_ROUTER_TIER,
  SESSION_TTL_MS,
  TRIVIAL_TASK_MAX_LENGTH,
} from './constants.js';

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

type ObservableLogLevel = 'debug' | 'info' | 'warn' | 'error';

type ObservableClient = {
  app?: {
    log?: (options: {
      body: {
        service: string;
        level: ObservableLogLevel;
        message: string;
        extra?: Record<string, unknown>;
      };
      query?: { directory?: string };
    }) => Promise<unknown>;
  };
};

type TuiShowToastClient = {
  tui?: {
    showToast?: (options: {
      body: {
        title: string;
        message: string;
        variant: 'warning';
        duration?: number;
      };
    }) => Promise<unknown>;
  };
};

type ShellEnvInput = {
  env?: Record<string, string>;
  conversationSettings?: {
    systemPrompt?: unknown;
  };
  sessionID?: string;
};

type ShellEnvOutput = {
  env?: Record<string, string>;
};

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
  private pendingCommandResponses = new Map<string, TextPart[]>();
  private log: FileLogger;

  constructor(
    private readonly ctx: PluginInput,
    private readonly config: RouterConfig,
  ) {
    this.log = new FileLogger();
  }

  get project(): PluginInput['project'] {
    return this.ctx.project;
  }

  get $(): PluginInput['$'] {
    return this.ctx.$;
  }

  get worktree(): PluginInput['worktree'] {
    return this.ctx.worktree;
  }

  async logObservable(level: ObservableLogLevel, message: string, data: Record<string, unknown> = {}): Promise<void> {
    const client = this.ctx.client as ObservableClient;
    if (typeof client.app?.log !== 'function') return;

    try {
      await client.app.log({
        body: { service: 'opencode-tier-router', level, message, extra: data },
        query: { directory: this.ctx.directory },
      });
    } catch {
      return;
    }
  }

  private async notifyToolBlocked(tier: TierName): Promise<void> {
    const client = this.ctx.client as TuiShowToastClient;
    if (typeof client.tui?.showToast !== 'function') return;

    try {
      await client.tui.showToast({
        body: {
          title: 'Acao bloqueada',
          message: 'Delegue para @heavy.',
          variant: 'warning',
          duration: 8000,
        },
      });
    } catch {
      return;
    }
  }

  private isSubagentShell(input: ShellEnvInput): boolean {
    const systemPrompt = input.conversationSettings?.systemPrompt;

    if (typeof systemPrompt === 'string') return systemPrompt.includes('subagent profile');
    if (typeof systemPrompt === 'function') return systemPrompt.toString().includes('subagent profile');

    const includes =
      systemPrompt && typeof (systemPrompt as { includes?: (substring: string) => boolean }).includes === 'function'
        ? (systemPrompt as { includes: (substring: string) => boolean }).includes
        : undefined;

    return Boolean(includes?.('subagent profile'));
  }

  private getRouterShellEnv(input: ShellEnvInput): Record<string, string> {
    const cfg = this.config;
    const sessionID = input.sessionID;
    const preferredTier = sessionID ? this.preferredTierSessions.get(sessionID) : undefined;
    const mappedSubagentTier = sessionID ? this.subagentTierMap.get(sessionID) : undefined;
    const hardBlockedTier = sessionID ? this.hardBlockedSessions.get(sessionID) : undefined;

    return {
      [OPENCODE_ROUTER_TIER]: preferredTier ?? mappedSubagentTier ?? hardBlockedTier ?? cfg.modes[cfg.mode]?.defaultTier ?? cfg.mode,
      [OPENCODE_ROUTER_MODE]: cfg.mode,
      [OPENCODE_ROUTER_HARD_BLOCKED]: hardBlockedTier ? 'true' : 'false',
    };
  }

  async handleShellEnv(input: ShellEnvInput, output: ShellEnvOutput): Promise<void> {
    if (!this.enabled || !this.isSubagentShell(input)) return;

    output.env = {
      ...(input.env ?? output.env ?? {}),
      ...this.getRouterShellEnv(input),
    };
  }

  private getRouterStateForSession(sessionID: string | undefined): RouterState {
    if (!sessionID) return {};

    const state: RouterState = {
      hardBlockedTier: this.hardBlockedSessions.get(sessionID) ?? null,
      hardBlockReason: this.hardBlockReasons.get(sessionID) ?? null,
    };

    const preferredTier = this.preferredTierSessions.get(sessionID);
    if (preferredTier) state.preferredTier = preferredTier;

    const selectionSource = this.selectionSourceSessions.get(sessionID);
    if (selectionSource) state.selectionSource = selectionSource;

    return state;
  }

  private buildRouterCompactionContext(routerState: RouterState): string {
    return `Router state: ${JSON.stringify(routerState)}`;
  }

  private applyRouterStateToCompactionContext(outputContext: unknown, routerState: RouterState): unknown {
    if (Array.isArray(outputContext)) {
      outputContext.push(this.buildRouterCompactionContext(routerState));
      return outputContext;
    }

    const context = outputContext ?? {};
    const existingRouter = (context as Record<string, unknown>).router ?? {};
    (context as Record<string, unknown>).router = {
      ...(existingRouter as Record<string, unknown>),
      ...routerState,
    };

    return context;
  }

  async handleSessionCompacting(input: SessionCompactingInput, output: SessionCompactingOutput): Promise<void> {
    if (!this.enabled || !input.sessionID) return;

    const routerState = this.getRouterStateForSession(input.sessionID);
    if (Object.keys(routerState).length === 0) return;

    output.context = this.applyRouterStateToCompactionContext(output.context, routerState);
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
      this.pendingCommandResponses.delete(id);
      this.capTracker.cleanup(id);
    }
  }

  private touchSession(sessionID: string): void {
    this.sessionActivity.set(sessionID, Date.now());
  }

  private async loadConfig(): Promise<RouterConfig> {
    return this.config;
  }

  get enabledState(): boolean {
    return this.enabled;
  }

  async handleConfig(input: Config): Promise<void> {
    try {
      const cfg = await this.loadConfig();

      try {
        assertEnforcement(cfg);
        this.log.info('Enforcement validation passed');
      } catch (enforcementErr) {
        await this.logObservable('error', 'Hook failed', {
          hook: 'config.enforcement-validation',
          error: enforcementErr instanceof Error ? enforcementErr.message : String(enforcementErr),
        });
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
      await this.logObservable('error', 'Hook failed', {
        hook: 'config',
        error: err instanceof Error ? err.message : String(err),
      });
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

      // DEBUG: dump full input structure for slash-command investigation
      this.log.info('chat.message input', {
        keys: Object.keys(input),
        agent: input.agent,
        sessionID: input.sessionID,
        partsCount: (input as any).parts?.length,
        partsFirst: JSON.stringify((input as any).parts?.[0]),
        partsFull: JSON.stringify((input as any).parts),
        messageText: (input as any).message?.text,
        messageSummaryTitle: (input as any).message?.summary?.title,
        messageRaw: JSON.stringify((input as any).message),
        inputRaw: JSON.stringify(input).slice(0, 500),
      });

      // Intercept slash commands that should not be sent to the model
      const msgText = messageText((input.parts ?? []) as Array<{ type?: string; text?: string }>);
      if (msgText.startsWith('/')) {
        const cmdLine = msgText.slice(1).trim().toLowerCase();
        const [cmdName, ...cmdArgs] = cmdLine.split(/\s+/);
        const cmdArg = cmdArgs.join(' ');

        if (cmdName === 'router') {
          if (cmdArg === 'on') {
            this.enabled = true;
            output.parts = [makeTextPart(input.sessionID, 'Tier router enabled.')];
          } else if (cmdArg === 'off') {
            this.enabled = false;
            output.parts = [makeTextPart(input.sessionID, 'Tier router disabled.')];
          } else {
            output.parts = [makeTextPart(input.sessionID, `Tier router is ${this.enabled ? 'on' : 'off'}.`)];
          }
          this.log.info('chat.message command intercepted', { cmdName, cmdArg });
          return;
        }

        if (cmdName === 'tiers') {
          const cfg = await this.loadConfig();
          const lines = [`Mode: ${cfg.mode}`, `Enforcement: ${cfg.enforcement.mode}`, `Tiers:`];
          for (const tier of ['fast', 'medium', 'heavy'] as const) {
            const t = cfg.tiers[tier];
            lines.push(`  @${tier}: ${t?.model ?? 'n/a'} (cost ${t?.costRatio ?? 'n/a'}x)`);
          }
          output.parts = [makeTextPart(input.sessionID, lines.join('\n'))];
          return;
        }
      }

      // Normalize agent name: the runtime may send "@fast" or "fast"
      const agent = input.agent?.replace(/^@/, '');
      const isTier = !!(agent && isTierName(agent));
      this.log.info('chat.message', { sessionID: input.sessionID, agent: input.agent, normalized: agent, isTier });

      if (isTier) {
        this.subagentSessions.add(input.sessionID);
        this.subagentTierMap.set(input.sessionID, agent);
        this.log.info('subagent routing state registered', { sessionID: input.sessionID, tier: agent });
        this.hardBlockedSessions.delete(input.sessionID);
        this.hardBlockReasons.delete(input.sessionID);
        this.preferredTierSessions.delete(input.sessionID);
        this.selectionSourceSessions.delete(input.sessionID);
        return;
      }

      this.subagentSessions.delete(input.sessionID);
      this.subagentTierMap.delete(input.sessionID);

      this.log.info('chat.message enabled check', { sessionID: input.sessionID, enabled: this.enabled });

      // If a command response is pending for this session (from command.execute.before),
      // replace the chat message with the command response so the model doesn't
      // see the original command text.
      const pendingResponse = this.pendingCommandResponses.get(input.sessionID);
      if (pendingResponse) {
        this.pendingCommandResponses.delete(input.sessionID);
        output.parts = pendingResponse;
        return;
      }

      if (!this.enabled) {
        this.log.info('chat.message router disabled, returning early', { sessionID: input.sessionID });
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
        await this.logObservable('info', 'Tier selected', { tier: desiredTier, source: selection.source });
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
      await this.logObservable('info', 'Hard-block triggered', { sessionID: input.sessionID, tier: desiredTier });
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
      await this.logObservable('error', 'Hook failed', {
        hook: 'chat.message',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('chat.message hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleSystemTransform(input: { sessionID?: string }, output: { system?: string[] }): Promise<void> {
    try {
      if (!this.enabled) return;
      if (input.sessionID && this.subagentSessions.has(input.sessionID)) return;

      const cfg = await this.loadConfig();
      output.system = output.system ?? [];

      const tier = input.sessionID ? this.hardBlockedSessions.get(input.sessionID) : undefined;
      if (cfg.enforcement.mode === 'hard-block' && tier) {
        const tiersLine = Object.entries(cfg.tiers)
          .map(([name, t]) => `@${name}=${t.model}(${t.costRatio}x)`)
          .join(' ');
        const rulesLine = Object.entries(cfg.taskPatterns)
          .map(([tierName, patterns]) => `@${tierName}→${patterns.join('/')}`)
          .join(' ');
        const activeMode = cfg.modes[cfg.mode];
        const emphasis = MODE_EMPHASIS[cfg.mode] ?? `mode ${cfg.mode}`;
        const reason = input.sessionID ? this.hardBlockReasons.get(input.sessionID) : undefined;
        output.system.push(buildHardBlockMessage(tier, tiersLine, rulesLine, emphasis, reason));
      } else {
        const protocol = buildDelegationProtocol(cfg);
        output.system.push(protocol);
      }

      const preferredTier = input.sessionID ? this.preferredTierSessions.get(input.sessionID) : undefined;
      if (preferredTier) {
        const source = input.sessionID ? this.selectionSourceSessions.get(input.sessionID) : undefined;
        output.system.push(buildRoutingHint(preferredTier, source));
      }
    } catch (err) {
      await this.logObservable('error', 'Hook failed', {
        hook: 'experimental.chat.system.transform',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('system.transform hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handlePermissionAsk(input: { sessionID?: string; type?: string }, output: { status?: string }): Promise<void> {
    try {
      if (!this.enabled) {
        output.status = 'allow';
        return;
      }
      if (!input.sessionID) return;

      this.log.info('permission.ask', {
        sessionID: input.sessionID,
        type: input.type,
        isSubagent: this.subagentSessions.has(input.sessionID),
        isHardBlocked: this.hardBlockedSessions.has(input.sessionID),
      });

      const tier = this.hardBlockedSessions.get(input.sessionID);
      const decision = evaluateSessionPermission({
        sessionIsSubagent: this.subagentSessions.has(input.sessionID),
        hardBlockedTier: tier,
        permissionName: input.type ?? '',
      });

      if (!isAllowed(decision)) {
        output.status = 'deny';
        return;
      }

      output.status = 'allow';
    } catch (err) {
      await this.logObservable('error', 'Hook failed', {
        hook: 'permission.ask',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('permission.ask hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async handleEvent(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> {
    try {
      if (!this.enabled) return;
      const event = input.event;

      // The internal bus publishes "permission.asked"; the SDK type uses "permission.updated".
      if (event.type !== 'permission.asked' && event.type !== 'permission.updated') return;

      const props = event.properties as
        | {
            id?: string;
            sessionID?: string;
            type?: string;
            permission?: string;
          }
        | undefined;
      if (!props?.sessionID) return;

      const client = (this.ctx as { client?: { postSessionIdPermissionsPermissionId?: Function } }).client;
      if (!client?.postSessionIdPermissionsPermissionId || !props.id) {
        this.log.warn('cannot reply:', {
          hasClient: !!client,
          hasMethod: !!(client as any)?.postSessionIdPermissionsPermissionId,
          hasId: !!props.id,
          sessionID: props.sessionID,
        });
        return;
      }

      const tier = this.hardBlockedSessions.get(props.sessionID);
      const decision = evaluateSessionPermission({
        sessionIsSubagent: this.subagentSessions.has(props.sessionID),
        hardBlockedTier: tier,
        permissionName: props.permission ?? props.type ?? '',
      });
      this.log.info('event', {
        sessionID: props.sessionID,
        permission: props.permission,
        tier: tier ?? null,
        isSubagent: this.subagentSessions.has(props.sessionID),
        decision: decision.status,
      });
      if (!isAllowed(decision)) {
        if (decision.kind === 'native') {
          void (client as any).tui?.showToast({
            body: {
              message: `[Router] Tool blocked. Delegate to @${tier} via task().`,
              variant: 'error',
              duration: 8000,
            },
          });
        }
        await client.postSessionIdPermissionsPermissionId({
          path: { id: props.sessionID, permissionID: props.id },
          body: { response: 'reject' },
        });
        return;
      }

      this.log.info('auto-allow', { sessionID: props.sessionID, permission: props.permission });
      // Non-hard-blocked session (subagent OR normal conversation) →
      // auto-allow with "once" so the tool executes without user dialog.
      // Using "once" (not "always") avoids adding permanent global allow rules
      // that would persist across sessions.
      await client.postSessionIdPermissionsPermissionId({
        path: { id: props.sessionID, permissionID: props.id },
        body: { response: 'once' },
      });
    } catch (err) {
      await this.logObservable('error', 'Hook failed', {
        hook: 'event',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('event hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private readonly HARD_BLOCK_DENIED_TOOLS = new Set(HARD_BLOCK_DENIED_TOOLS);

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

  async handleToolExecuteBefore(
    input: { sessionID?: string; tool: string; callID?: string },
    output: { allow?: boolean; message?: string; args?: unknown },
  ): Promise<void> {
    try {
      if (!this.enabled) return;
      if (!input.sessionID) return;

      if (this.subagentSessions.has(input.sessionID)) {
        output.allow = true;
        delete output.message;
        return;
      }

      const tier = this.hardBlockedSessions.get(input.sessionID);
      const decision = evaluateSessionPermission({
        sessionIsSubagent: false,
        hardBlockedTier: tier,
        permissionName: input.tool,
      });
      if (!tier || decision.status !== 'deny' || decision.kind !== 'native') return;

      await this.notifyToolBlocked(tier);
      this.log.info('Denied tool blocked before execution', {
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
      });
      delete output.args;
      delete output.message;
      output.allow = false;
      output.message = HARD_BLOCK_DELEGATION_MESSAGE;
    } catch (err) {
      await this.logObservable('error', 'Hook failed', {
        hook: 'tool.execute.before',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('tool.execute.before hook failed:', err instanceof Error ? err.message : String(err));
    }
  }

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
      await this.logObservable('error', 'Hook failed', {
        hook: 'tool.definition',
        error: err instanceof Error ? err.message : String(err),
      });
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
      await this.logObservable('error', 'Hook failed', {
        hook: 'tool.execute.after',
        error: err instanceof Error ? err.message : String(err),
      });
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
      await this.logObservable('error', 'Hook failed', {
        hook: 'experimental.text.complete',
        error: err instanceof Error ? err.message : String(err),
      });
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

      // DEBUG: dump command.execute.before input
      this.log.info('command.execute.before input', {
        keys: Object.keys(input),
        command: input.command,
        arguments: input.arguments,
        sessionID: input.sessionID,
        raw: JSON.stringify(input).slice(0, 500),
      });
      const raw = input.command.replace(/^\//, '').toLowerCase();
      const parts = raw.split(/\s+/);
      const command = parts[0];
      const args = (parts.slice(1).join(' ') + ' ' + (input.arguments ?? '')).trim();

      if (command === 'router') {
        if (args === 'on') {
          this.enabled = true;
          output.parts = [makeTextPart(input.sessionID, 'Tier router enabled.')];
          this.pendingCommandResponses.set(input.sessionID, output.parts);
          return;
        }
        if (args === 'off') {
          this.enabled = false;
          this.log.info('router command set enabled', { enabled: this.enabled, sessionID: input.sessionID });
          output.parts = [makeTextPart(input.sessionID, 'Tier router disabled.')];
          this.pendingCommandResponses.set(input.sessionID, output.parts);
          return;
        }
        output.parts = [makeTextPart(input.sessionID, `Tier router is ${this.enabled ? 'on' : 'off'}.`)];
        this.log.info('command.execute.before router intercepted', { command, args });
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
        const raw = input.command.replace(/^\//, '').toLowerCase();
        const parts = raw.split(/\s+/);
        const command = parts[0];
        const args = (parts.slice(1).join(' ') + ' ' + (input.arguments ?? '')).trim();

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
        Object.assign(this.config, { mode: modeName });
        output.parts = [makeTextPart(input.sessionID, `Switched to ${modeName} mode.`)];
        return;
      }
    } catch (err) {
      await this.logObservable('error', 'Hook failed', {
        hook: 'command.execute.before',
        error: err instanceof Error ? err.message : String(err),
      });
      this.log.warn('command.execute.before hook failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
