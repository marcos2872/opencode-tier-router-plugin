import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Config } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import { loadTiers, saveMode, ConfigError, type RouterConfig } from './router/config.js';
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

const TIER_NAMES = ['fast', 'medium', 'heavy'] as const;
type TierName = (typeof TIER_NAMES)[number];
const AGENT_TIER_MAP: Record<string, TierName> = {
  explore: 'fast',
  build: 'medium',
  general: 'heavy',
  plan: 'heavy',
};

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
    trivialDirectAllowed: false, // ✅ SEMPRE delegar, NUNCA executar diretamente
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
};

function messageText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

function isTrivialFastTask(text: string): boolean {
  const compact = text.toLowerCase().trim();
  if (compact.length === 0 || compact.length > 120) return false;
  const trivialHint = /\b(find|grep|search|where|locate|list|show|read|explore|buscar|procurar|ler|listar|mostrar)\b/i;
  const multiStepHint = /\b(and then|depois|em seguida|follow-up|implement|refactor|design|architecture|debug|analyze|implementar|refatorar|arquitetura|depurar|analisar)\b/i;
  return trivialHint.test(compact) && !multiStepHint.test(compact);
}

function isTierName(name: string): name is TierName {
  return (TIER_NAMES as readonly string[]).includes(name);
}

function isToolOutputWithUsage(out: unknown): out is ToolExecuteOutput {
  return out !== null && typeof out === 'object' && ('usage' in out || 'output' in out);
}

function globalConfigDir(): string {
  return join(homedir(), '.config', 'opencode');
}

async function loadConfig(projectDir: string): Promise<RouterConfig> {
  try {
    return await loadTiers(projectDir, globalConfigDir());
  } catch (err) {
    // Missing config is expected — use defaults silently.
    if (
      err instanceof ConfigError &&
      (err.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
    ) {
      return FALLBACK_CONFIG;
    }

    // best-effort: never crash a real session
    console.warn(
      '[opencode-tier-router] failed to load tiers.json, using defaults:',
      err instanceof Error ? err.message : String(err),
    );
    return FALLBACK_CONFIG;
  }
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

const tierRouterPlugin: Plugin = async (ctx) => {
  const capTracker = createCapTracker();
  const subagentSessions = new Set<string>();
  const hardBlockedSessions = new Map<string, TierName>();
  const hardBlockReasons = new Map<string, string>();
  const preferredTierSessions = new Map<string, TierName>();
  const selectionSourceSessions = new Map<string, SelectionSource>();
  let enabled = true;

  // Initialize TokenTracker for FASE3 commands
  let tokenTracker: TokenTracker | null = null;
  const initializeTokenTracker = async () => {
    try {
      const cfg = await loadConfig(ctx.directory);
      const storage = new FilesystemStorage();
      const parser = new DefaultTokenEventParser();
      const aggregator = new DefaultMetricsAggregator();
      const formatter = new MarkdownMetricsFormatter();
      const storageDir = join(ctx.directory, '.opencode', 'token-metrics');
      tokenTracker = new TokenTracker(storage, parser, aggregator, formatter, cfg, storageDir);
    } catch (err) {
      console.error('[opencode-tier-router] Failed to initialize token tracker:', err);
    }
  };

  return {
    config: async (input: Config) => {
      try {
        const cfg = await loadConfig(ctx.directory);

        // ✅ CRITICAL: Validate enforcement rules at initialization
        try {
          assertEnforcement(cfg);
          console.log('[opencode-tier-router] Enforcement validation passed');
        } catch (enforcementErr) {
          console.warn(
            '[opencode-tier-router] CRITICAL: Enforcement validation failed. Config is invalid for 100% delegation.',
          );
          console.warn(reportEnforcement(cfg));
          // Best-effort: continue but log the issue
        }

        // Initialize token tracker for FASE3 commands
        await initializeTokenTracker();

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

        // Align OpenCode built-in agent names with tier models so delegation keeps the expected model.
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
        // FASE3: Token tracking commands
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
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] config hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'chat.message': async (input, output) => {
      try {
        if (input.agent && isTierName(input.agent)) {
          subagentSessions.add(input.sessionID);
          hardBlockedSessions.delete(input.sessionID);
          hardBlockReasons.delete(input.sessionID);
          preferredTierSessions.delete(input.sessionID);
          selectionSourceSessions.delete(input.sessionID);
          return;
        }

        if (!enabled) {
          hardBlockedSessions.delete(input.sessionID);
          hardBlockReasons.delete(input.sessionID);
          preferredTierSessions.delete(input.sessionID);
          selectionSourceSessions.delete(input.sessionID);
          return;
        }

        const cfg = await loadConfig(ctx.directory);
        const mappedTier = input.agent ? AGENT_TIER_MAP[input.agent] : undefined;

        const summaryText = `${output.message.summary?.title ?? ''}\n${output.message.summary?.body ?? ''}`.trim();
        const text = summaryText || messageText((output.parts ?? []) as Array<{ type?: string; text?: string }>);
        const selection = await selectTierByStrategy(text, cfg, ctx.client);
        const desiredTier = selection.tier ?? mappedTier ?? null;

        if (desiredTier) {
          preferredTierSessions.set(input.sessionID, desiredTier);
          selectionSourceSessions.set(input.sessionID, selection.source);
        } else {
          preferredTierSessions.delete(input.sessionID);
          selectionSourceSessions.delete(input.sessionID);
        }

        if (cfg.enforcement.mode !== 'hard-block') {
          hardBlockedSessions.delete(input.sessionID);
          hardBlockReasons.delete(input.sessionID);
          return;
        }

        if (!desiredTier) {
          hardBlockedSessions.delete(input.sessionID);
          hardBlockReasons.delete(input.sessionID);
          return;
        }

        if (desiredTier === 'fast' && cfg.enforcement.trivialDirectAllowed && isTrivialFastTask(text)) {
          hardBlockedSessions.delete(input.sessionID);
          hardBlockReasons.delete(input.sessionID);
          return;
        }

        hardBlockedSessions.set(input.sessionID, desiredTier);
        if (mappedTier && mappedTier !== desiredTier) {
          hardBlockReasons.set(
            input.sessionID,
            `Current agent maps to @${mappedTier}, but this request was classified as @${desiredTier}. Redirect to @${desiredTier}.`,
          );
        } else {
          hardBlockReasons.set(input.sessionID, `This request requires @${desiredTier}.`);
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] chat.message hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      try {
        if (!enabled) return;
        if (input.sessionID && subagentSessions.has(input.sessionID)) return;

        const cfg = await loadConfig(ctx.directory);
        const protocol = buildDelegationProtocol(cfg);
        output.system = output.system ?? [];
        output.system.push(protocol);

        const preferredTier = input.sessionID ? preferredTierSessions.get(input.sessionID) : undefined;
        if (preferredTier) {
          const source = input.sessionID ? selectionSourceSessions.get(input.sessionID) : undefined;
          output.system.push(
            `Routing hint: Preferred tier for this request is @${preferredTier}${source ? ` (source: ${source})` : ''}. Delegate to @${preferredTier} when not trivial.`,
          );
        }

        const tier = input.sessionID ? hardBlockedSessions.get(input.sessionID) : undefined;
        if (cfg.enforcement.mode === 'hard-block' && tier) {
          const reason = input.sessionID ? hardBlockReasons.get(input.sessionID) : undefined;
          output.system.push(
            `HARD-BLOCK: This request MUST be delegated to @${tier}. Do not execute tools directly in this session. Attempt delegation now. If direct execution is blocked, immediately delegate to @${tier}.${reason ? ` ${reason}` : ''}`,
          );
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] system.transform hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'permission.ask': async (input, output) => {
      try {
        if (!enabled) return;
        if (!input.sessionID || subagentSessions.has(input.sessionID)) return;

        const tier = hardBlockedSessions.get(input.sessionID);
        if (!tier) return;

        if (input.type === 'bash' || input.type === 'edit' || input.type === 'webfetch') {
          output.status = 'deny';
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] permission.ask hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'tool.execute.after': async (input, output) => {
      try {
        if (!enabled) return;
        if (!input.sessionID) return;

        // Record cap tracking (existing behavior)
        if (subagentSessions.has(input.sessionID)) {
          capTracker.record(input.sessionID, input.tool, input.args ?? {});
          const banner = capTracker.getBanner(input.sessionID, input.tool, input.args ?? {});
          if (banner) {
            output.output += `\n${banner}`;
          }
        }

        // FASE5: Record token usage for tracking
        if (tokenTracker) {
          let out: ToolExecuteOutput;
          if (isToolOutputWithUsage(output)) {
            out = output;
          } else {
            out = {};
          }
          let usage = out.usage;
          if (!usage && out.output) {
            // Try to extract usage from output string (if JSON-encoded)
            try {
              const parsed = JSON.parse(out.output);
              usage = parsed.usage || usage;
            } catch {
              // Not JSON, skip
            }
          }

          if (usage) {
            const inputTokens = usage.inputTokens ?? usage.input ?? 0;
            const outputTokens = usage.outputTokens ?? usage.output ?? 0;
            const reasoningTokens = usage.reasoningTokens ?? usage.reasoning ?? 0;
            const cacheRead = usage.cacheReadTokens ?? usage.cache?.read ?? 0;
            const cacheWrite = usage.cacheWriteTokens ?? usage.cache?.write ?? 0;

            // Estimate cost based on tier
            // Most providers charge ~$0.0015/1k input, ~$0.006/1k output
            const estimatedCost = ((inputTokens * 0.0015) + (outputTokens * 0.006)) / 1000;

            // Get current routing decision for this session
            const tier = preferredTierSessions.get(input.sessionID);
            const cfg = await loadConfig(ctx.directory);
            const routing = tier ? {
              tier: tier,
              costRatio: cfg.tiers[tier]?.costRatio ?? 1,
            } : undefined;

            // Record the event
            await tokenTracker.recordStepFinish({
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

            // If we have a routing decision, record it too for correlation
            if (routing) {
              await tokenTracker.recordRoutingDecision(input.sessionID, routing);
            }
          }
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] tool.execute.after hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'experimental.text.complete': async (_input, output) => {
      try {
        if (!enabled) return;

        const match = detectNarration(output.text);
        if (match) {
          output.text += `\n\n[⚠ narration detected: "${match}"]`;
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] text.complete hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

    'command.execute.before': async (input, output) => {
      try {
        const command = input.command.replace(/^\//, '').toLowerCase();
        const args = input.arguments.trim();

        // FASE3: Handle token tracking commands
        if (isTokenCommand(command) && tokenTracker) {
          const result = await executeTokenCommand(tokenTracker, command, args);
          if (result !== null) {
            output.parts = [makeTextPart(input.sessionID, result)];
            return;
          }
        }

        if (command === 'router') {
          if (args === 'on') {
            enabled = true;
            output.parts = [makeTextPart(input.sessionID, 'Tier router enabled.')];
            return;
          }
          if (args === 'off') {
            enabled = false;
            output.parts = [makeTextPart(input.sessionID, 'Tier router disabled.')];
            return;
          }
          output.parts = [makeTextPart(input.sessionID, `Tier router is ${enabled ? 'on' : 'off'}.`)];
          return;
        }

        if (command === 'tiers') {
          const cfg = await loadConfig(ctx.directory);
          const preferredTier = preferredTierSessions.get(input.sessionID);
          const source = selectionSourceSessions.get(input.sessionID);
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
          const cfg = await loadConfig(ctx.directory);

          if (!args) {
            const lines = Object.entries(cfg.modes).map(([name, mode]) => {
              const marker = name === cfg.mode ? '→ ' : '  ';
              return `${marker}${name}: ${mode.description ?? ''}`;
            });
            output.parts = [makeTextPart(input.sessionID, `Routing modes:\n${lines.join('\n')}`)];
            return;
          }

          const modeName = args.split(/\s+/)[0];
          if (!cfg.modes[modeName]) {
            const available = Object.keys(cfg.modes).join(', ');
            output.parts = [makeTextPart(input.sessionID, `Unknown mode "${modeName}". Available modes: ${available}`)];
            return;
          }

          await saveMode(modeName, ctx.directory);
          output.parts = [makeTextPart(input.sessionID, `Switched to ${modeName} mode.`)];
          return;
        }
      } catch (err) {
        // best-effort: never crash a real session
        console.warn('[opencode-tier-router] command.execute.before hook failed:', err instanceof Error ? err.message : String(err));
      }
    },

  };
};

export default tierRouterPlugin;
