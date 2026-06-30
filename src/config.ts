import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

export type TierName = 'fast' | 'medium' | 'heavy';

export interface TierConfig {
  model?: string;
  systemPrompt?: string;
  costRatio?: number;
  cap?: number;
}

export interface ModeConfig {
  description?: string;
  defaultTier: string;
}

export interface RouterConfig {
  mode: string;
  agentName?: string;
  agentModel?: string;
  routerPrompt?: string;
  tiers: Record<TierName, TierConfig>;
  modes: Record<string, ModeConfig>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_AGENT_MODEL = 'opencode/big-pickle';
const DEFAULT_AGENT_NAME = 'router';

const DEFAULT_ROUTER_PROMPT = `Você é o Router, um agente orquestrador especializado em delegar tarefas para subagentes especializados.

Você NÃO tem permissão para ler arquivos, executar comandos, editar código ou acessar o projeto diretamente.
Sua única função é analisar a solicitação do usuário e delegar para o subagente mais adequado.

## Tiers disponíveis

- @fast: Consultas rápidas, buscas, leitura de arquivos, git log/status, grep. Custo baixo. Use para tarefas simples e rápidas.
- @medium: Implementação, refatoração, correção de bugs, adição de funcionalidades. Custo médio. Use para tarefas de codificação.
- @heavy: Arquitetura, design, debugging complexo, análise de performance, otimização. Custo alto. Use apenas para tarefas complexas.

## Regras de delegação

1. Analise a solicitação do usuário e identifique o tipo de trabalho necessário
2. Escolha o tier MAIS BARATO que atende à tarefa
   - Use @fast para consultas, buscas, leitura e tarefas simples
   - Use @medium para implementação e refatoração
   - Use @heavy apenas para arquitetura, debugging complexo e design
3. Chame task() com:
   - subagent_type: use APENAS "fast", "medium" ou "heavy"
   - prompt: inclua [INSTRUÇÃO DO USUÁRIO] com o texto original e [CONTEXTO ADICIONAL] se necessário
4. NUNCA use "explore", "general", "summarize" ou outros tipos de agente — apenas os três tiers acima
5. NUNCA tente executar a tarefa você mesmo — você não tem ferramentas para isso
6. Se não conseguir classificar, use @medium como fallback`;

const DEFAULT_FAST_SYSTEM_PROMPT = `Você é @fast — agente de consulta rápida e leve.
Regras:
- Seja direto e conciso, sem análise profunda
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Se a tarefa exigir análise complexa ou debug, avise que talvez precise do @medium ou @heavy`;

const DEFAULT_MEDIUM_SYSTEM_PROMPT = `Você é @medium — agente de implementação e refatoração.
Regras:
- Implemente, refatore, corrija e edite conforme solicitado
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Prefira soluções simples e diretas; para mudanças arquiteturais profundas, avise que @heavy pode ser mais adequado`;

const DEFAULT_HEAVY_SYSTEM_PROMPT = `Você é @heavy — agente de análise profunda e arquitetura.
Regras:
- Analise, projete, debuge e otimize com profundidade
- NÃO dispare sub-sub-agentes
- NÃO pergunte ao usuário a menos que esteja bloqueado
- Considere trade-offs, impacto no sistema todo, e documente decisões`;

const DEFAULT_TIER_MODELS: Record<TierName, string> = {
  fast: 'opencode/big-pickle',
  medium: 'llama.cpp/Nex-N2-mini',
  heavy: 'llama.cpp/Nex-N2-mini',
};

const DEFAULT_CONFIG: RouterConfig = {
  mode: 'balanced',
  agentName: DEFAULT_AGENT_NAME,
  agentModel: DEFAULT_AGENT_MODEL,
  routerPrompt: DEFAULT_ROUTER_PROMPT,
  tiers: {
    fast: {
      model: DEFAULT_TIER_MODELS.fast,
      systemPrompt: DEFAULT_FAST_SYSTEM_PROMPT,
      costRatio: 1,
      cap: 8,
    },
    medium: {
      model: DEFAULT_TIER_MODELS.medium,
      systemPrompt: DEFAULT_MEDIUM_SYSTEM_PROMPT,
      costRatio: 5,
      cap: 12,
    },
    heavy: {
      model: DEFAULT_TIER_MODELS.heavy,
      systemPrompt: DEFAULT_HEAVY_SYSTEM_PROMPT,
      costRatio: 20,
      cap: 20,
    },
  },
  modes: {
    balanced: {
      description: 'Router decide o tier ideal baseado na tarefa',
      defaultTier: 'medium',
    },
    budget: {
      description: 'Router prefere @fast sempre que possível',
      defaultTier: 'fast',
    },
    quality: {
      description: 'Router prefere @medium ou @heavy',
      defaultTier: 'medium',
    },
  },
};

function pathExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function normalizeConfigPath(tiersJsonPath: string): string {
  return existsSync(tiersJsonPath) && statSync(tiersJsonPath).isDirectory()
    ? join(tiersJsonPath, 'tiers.json')
    : tiersJsonPath;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateConfig(config: unknown): asserts config is RouterConfig {
  if (!isObject(config)) {
    throw new ConfigError('tiers.json must be a JSON object');
  }

  const cfg = config as Partial<RouterConfig>;

  if (typeof cfg.mode !== 'string' || cfg.mode.length === 0) {
    throw new ConfigError('mode must be a non-empty string');
  }
  if (!isObject(cfg.tiers)) {
    throw new ConfigError('tiers must be an object');
  }
  if (!isObject(cfg.modes)) {
    throw new ConfigError('modes must be an object');
  }
  if (!cfg.modes[cfg.mode] || typeof cfg.modes[cfg.mode] !== 'object') {
    throw new ConfigError(`active mode "${cfg.mode}" is not defined in modes`);
  }

  if (cfg.agentName !== undefined && typeof cfg.agentName !== 'string') {
    throw new ConfigError('agentName must be a string');
  }
  if (typeof cfg.agentName === 'string' && cfg.agentName.length === 0) {
    throw new ConfigError('agentName must not be empty');
  }
  if (cfg.agentModel !== undefined && typeof cfg.agentModel !== 'string') {
    throw new ConfigError('agentModel must be a string');
  }
  if (typeof cfg.agentModel === 'string' && cfg.agentModel.length === 0) {
    throw new ConfigError('agentModel must not be empty');
  }
  if (cfg.routerPrompt !== undefined && typeof cfg.routerPrompt !== 'string') {
    throw new ConfigError('routerPrompt must be a string');
  }

  const tiers = cfg.tiers as Record<string, TierConfig>;
  for (const tierName of Object.keys(tiers)) {
    const tier = tiers[tierName];
    if (!isObject(tier)) {
      throw new ConfigError(`tier "${tierName}" must be an object`);
    }
    if (tier.systemPrompt !== undefined && typeof tier.systemPrompt !== 'string') {
      throw new ConfigError(`tier "${tierName}" systemPrompt must be a string`);
    }
  }

  for (const [modeName, mode] of Object.entries(cfg.modes)) {
    if (!isObject(mode)) {
      throw new ConfigError(`mode "${modeName}" must be an object`);
    }
    const defaultTier = mode.defaultTier;
    if (typeof defaultTier !== 'string' || defaultTier.length === 0) {
      throw new ConfigError(`mode "${modeName}" is missing defaultTier`);
    }
    if (!tiers[defaultTier]) {
      throw new ConfigError(`mode "${modeName}" defaultTier "${defaultTier}" does not exist in tiers`);
    }
  }
}

function normalizeConfig(config: unknown): RouterConfig {
  validateConfig(config);
  const cfg = config as RouterConfig;

  return {
    mode: cfg.mode,
    agentName: cfg.agentName ?? DEFAULT_AGENT_NAME,
    agentModel: cfg.agentModel ?? DEFAULT_AGENT_MODEL,
    routerPrompt: cfg.routerPrompt ?? DEFAULT_ROUTER_PROMPT,
    tiers: {
      fast: {
        model: cfg.tiers.fast?.model ?? DEFAULT_TIER_MODELS.fast,
        systemPrompt: cfg.tiers.fast?.systemPrompt ?? DEFAULT_FAST_SYSTEM_PROMPT,
        costRatio: cfg.tiers.fast?.costRatio,
        cap: cfg.tiers.fast?.cap,
      },
      medium: {
        model: cfg.tiers.medium?.model ?? DEFAULT_TIER_MODELS.medium,
        systemPrompt: cfg.tiers.medium?.systemPrompt ?? DEFAULT_MEDIUM_SYSTEM_PROMPT,
        costRatio: cfg.tiers.medium?.costRatio,
        cap: cfg.tiers.medium?.cap,
      },
      heavy: {
        model: cfg.tiers.heavy?.model ?? DEFAULT_TIER_MODELS.heavy,
        systemPrompt: cfg.tiers.heavy?.systemPrompt ?? DEFAULT_HEAVY_SYSTEM_PROMPT,
        costRatio: cfg.tiers.heavy?.costRatio,
        cap: cfg.tiers.heavy?.cap,
      },
    },
    modes: cfg.modes,
  };
}

function readConfig(path: string): RouterConfig {
  const raw = readFileSync(path, 'utf8');
  return normalizeConfig(JSON.parse(raw));
}

export function loadConfig(tiersJsonPath?: string): RouterConfig {
  const requestedPath = tiersJsonPath ?? join(process.cwd(), 'tiers.json');
  const projectPath = normalizeConfigPath(requestedPath);
  const globalPath = join(homedir(), '.config', 'opencode', 'tiers.json');

  if (pathExists(projectPath)) {
    return readConfig(projectPath);
  }

  if (pathExists(globalPath)) {
    return readConfig(globalPath);
  }

  mkdirSync(dirname(projectPath), { recursive: true });
  writeFileSync(projectPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  return normalizeConfig(DEFAULT_CONFIG);
}

export function createRouterAgent(input: { agent?: Record<string, unknown> }, cfg: RouterConfig): void {
  const routerName = cfg.agentName ?? DEFAULT_AGENT_NAME;
  if (!input.agent) {
    input.agent = {};
  }
  if (input.agent[routerName]) {
    return;
  }

  input.agent[routerName] = {
    model: cfg.agentModel ?? DEFAULT_AGENT_MODEL,
    systemPrompt: cfg.routerPrompt ?? DEFAULT_ROUTER_PROMPT,
    permission: {
      task: 'allow',
      read: 'deny',
      glob: 'deny',
      grep: 'deny',
      list: 'deny',
      bash: 'deny',
      edit: 'deny',
      write: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      skill: 'allow',
      question: 'deny',
      tool: 'deny',
    },
    description: 'Router agent — delegates tasks to @fast, @medium or @heavy and does not run native tools',
  };
}

export function createTierSubagents(input: { agent?: Record<string, unknown> }, cfg: RouterConfig): void {
  if (!input.agent) {
    input.agent = {};
  }

  for (const tierName of ['fast', 'medium', 'heavy'] as const) {
    const tier = cfg.tiers[tierName];
    input.agent[tierName] = {
      model: tier.model ?? DEFAULT_TIER_MODELS[tierName],
      mode: 'subagent',
      systemPrompt:
        tier.systemPrompt ??
        (tierName === 'fast'
          ? DEFAULT_FAST_SYSTEM_PROMPT
          : tierName === 'medium'
            ? DEFAULT_MEDIUM_SYSTEM_PROMPT
            : DEFAULT_HEAVY_SYSTEM_PROMPT),
      permission: {
        task: 'allow',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        bash: 'allow',
        edit: 'allow',
        write: 'allow',
        webfetch: 'allow',
        websearch: 'allow',
        skill: 'allow',
        question: 'allow',
        tool: 'allow',
      },
      description: `Tier router @${tierName} subagent`,
    };
  }
}
