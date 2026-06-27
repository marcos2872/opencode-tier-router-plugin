import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Config } from '@opencode-ai/plugin';
import type { TextPart } from '@opencode-ai/sdk';
import { loadTiers, saveMode, ConfigError, type RouterConfig } from './router/config.js';
import { buildDelegationProtocol } from './router/protocol.js';
import { classifyTask } from './router/classifier.js';
import { createCapTracker } from './router/caps.js';
import { detectNarration } from './narration.js';

const TIER_NAMES = ['fast', 'medium', 'heavy'] as const;
type TierName = (typeof TIER_NAMES)[number];
const AGENT_TIER_MAP: Record<string, TierName> = {
  explore: 'fast',
  build: 'medium',
  general: 'heavy',
  plan: 'heavy',
};

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
    fast: ['find', 'grep', 'search', 'where', 'locate', 'list', 'show', 'read', 'explore', 'buscar', 'procurar', 'ler', 'listar', 'mostrar'],
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
    mode: 'advisory',
    trivialDirectAllowed: true,
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
  let enabled = true;

  return {
    config: async (input: Config) => {
      try {
        const cfg = await loadConfig(ctx.directory);

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
          return;
        }

        if (!enabled) {
          hardBlockedSessions.delete(input.sessionID);
          return;
        }

        const cfg = await loadConfig(ctx.directory);
        if (cfg.enforcement.mode !== 'hard-block') {
          hardBlockedSessions.delete(input.sessionID);
          return;
        }

        const mappedTier = input.agent ? AGENT_TIER_MAP[input.agent] : undefined;
        if (mappedTier) {
          if (mappedTier === 'fast' && cfg.enforcement.trivialDirectAllowed) {
            hardBlockedSessions.delete(input.sessionID);
            return;
          }
          hardBlockedSessions.set(input.sessionID, mappedTier);
          return;
        }

        const summaryText = `${output.message.summary?.title ?? ''}\n${output.message.summary?.body ?? ''}`.trim();
        const text = summaryText || messageText((output.parts ?? []) as Array<{ type?: string; text?: string }>);
        const explicitClassification = classifyTask(text, cfg.taskPatterns);
        const defaultTier = cfg.modes[cfg.mode]?.defaultTier;
        const fallbackTier = defaultTier && isTierName(defaultTier) ? defaultTier : null;
        const classification = explicitClassification ?? (text.length > 0 ? fallbackTier : null);

        if (!classification) {
          hardBlockedSessions.delete(input.sessionID);
          return;
        }

        if (classification === 'fast' && cfg.enforcement.trivialDirectAllowed && isTrivialFastTask(text)) {
          hardBlockedSessions.delete(input.sessionID);
          return;
        }

        hardBlockedSessions.set(input.sessionID, classification);
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

        const tier = input.sessionID ? hardBlockedSessions.get(input.sessionID) : undefined;
        if (cfg.enforcement.mode === 'hard-block' && tier) {
          output.system.push(
            `HARD-BLOCK: This request MUST be delegated to @${tier}. Do not execute tools directly in this session. Attempt delegation now. If direct execution is blocked, immediately delegate to @${tier}.`,
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
        if (!input.sessionID || !subagentSessions.has(input.sessionID)) return;

        capTracker.record(input.sessionID, input.tool, input.args ?? {});
        const banner = capTracker.getBanner(input.sessionID, input.tool, input.args ?? {});
        if (banner) {
          output.output += `\n${banner}`;
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
          const lines = [
            `Mode: ${cfg.mode} (${cfg.modes[cfg.mode]?.description ?? ''})`,
            `Enforcement: ${cfg.enforcement.mode} (trivial direct allowed: ${cfg.enforcement.trivialDirectAllowed ? 'yes' : 'no'})`,
            `Agent mapping: explore->@fast, build->@medium, general->@heavy, plan->@heavy`,
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
