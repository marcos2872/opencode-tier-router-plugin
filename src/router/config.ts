import { access, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_FAST_COST_RATIO,
  DEFAULT_HEAVY_COST_RATIO,
  DEFAULT_HEAVY_TIER_CAP,
  DEFAULT_MEDIUM_COST_RATIO,
  DEFAULT_MEDIUM_TIER_CAP,
  DEFAULT_TIER_CAP,
  FAST_TIER_MAX_TOKENS,
  HEAVY_TIER_MIN_TOKENS,
  LRU_MAX_SESSIONS,
  MAX_HISTORY_DAYS,
  MAX_HISTORY_FILES,
  MEDIUM_TIER_MAX_TOKENS,
  SESSION_TTL_MINUTES,
} from '../constants.js';

/**
 * Nome de tier usado pelo router.
 */
export type TierName = 'fast' | 'medium' | 'heavy';

/**
 * Limites de limiar de tokens para um tier.
 */
export interface TokenThresholds {
  /**
   * Contagem mínima de tokens para este tier.
   */
  min: number;

  /**
   * Contagem máxima de tokens para este tier, ou `null` para ilimitado.
   */
  max: number | null;
}

/**
 * Configuração para um tier do router.
 */
export interface TierConfig {
  /**
   * Identificador do modelo OpenCode para este tier.
   */
  model: string;

  /**
   * Multiplicador de custo relativo para este tier.
   */
  costRatio: number;

  /**
   * Contagem máxima permitida de chamadas para este tier.
   */
  cap: number;

  /**
   * Limites opcionais de limiar de tokens para este tier.
   */
  thresholds?: TokenThresholds;
}

/**
 * Configuração para um modo de roteamento.
 */
export interface ModeConfig {
  /**
   * Descrição legível por humanos do modo.
   */
  description?: string;

  /**
   * Nome do tier padrão selecionado quando nenhum classificador corresponde.
   */
  defaultTier: string;
}

/**
 * Padrões de palavras-chave agrupados por tier.
 */
export interface TaskPatterns {
  /**
   * Palavras-chave que devem rotear para o tier fast.
   */
  fast: string[];

  /**
   * Palavras-chave que devem rotear para o tier medium.
   */
  medium: string[];

  /**
   * Palavras-chave que devem rotear para o tier heavy.
   */
  heavy: string[];
}

/**
 * Política de aplicação para delegação.
 */
export interface EnforcementConfig {
  /**
   * Modo de aplicação: avisos advisory ou hard-block.
   */
  mode: 'advisory' | 'hard-block';

  /**
   * Indica se tarefas rápidas triviais podem executar diretamente.
   */
  trivialDirectAllowed: boolean;
}

/**
 * Configuração de roteamento para seleção de estratégia.
 */
export interface RoutingConfig {
  /**
   * Estratégia de roteamento a usar.
   */
  strategy: 'keyword' | 'llm';

  /**
   * Modelo de selector usado quando roteamento `llm` está habilitado.
   */
  selectorModel: string;

  /**
   * Tempo limite do selector em milissegundos.
   */
  selectorTimeoutMs: number;

  /**
   * Número máximo de tokens de saída do selector.
   */
  selectorMaxTokens: number;
}

/**
 * Configuração de rastreamento de tokens.
 */
export interface TokenTrackingConfig {
  /**
   * Indica se o rastreamento de tokens está habilitado quando presente.
   */
  enabled?: boolean;

  /**
   * Número máximo de arquivos de métricas de tokens persistidos para reter.
   */
  maxHistoryFiles?: number;

  /**
   * Número máximo de dias para reter registros históricos de tokens.
   */
  maxHistoryDays?: number;

  /**
   * TTL da sessão em minutos antes da expiração.
   */
  sessionTTLMinutes?: number;

  /**
   * Número máximo de sessões mantidas em memória antes da evicção LRU.
   */
  maxSessionsMemory?: number;
}

/**
 * Configuração completa do router.
 */
export interface RouterConfig {
  /**
   * Nome do modo de roteamento ativo.
   */
  mode: string;

  /**
   * Definições de tiers agrupadas pelo nome do tier.
   */
  tiers: Record<string, TierConfig>;

  /**
   * Modos de roteamento agrupados pelo nome do modo.
   */
  modes: Record<string, ModeConfig>;

  /**
   * Padrões de palavras-chave de tiers.
   */
  taskPatterns: TaskPatterns;

  /**
   * Política de aplicação.
   */
  enforcement: EnforcementConfig;

  /**
   * Configuração da estratégia de roteamento.
   */
  routing: RoutingConfig;

  /**
   * Configuração opcional de rastreamento de tokens.
   */
  tokenTracking?: TokenTrackingConfig;
}

/**
 * Resumo de tiers ativos para o modo selecionado.
 */
export interface ActiveTiers {
  /**
   * Tier padrão para o modo ativo.
   */
  defaultTier: string;

  /**
   * Definições de tiers disponíveis para o router.
   */
  tiers: Record<string, TierConfig>;
}

/**
 * Erro de configuração lançado quando tiers.json é inválido.
 */
export class ConfigError extends Error {
  /**
   * Cria um erro de configuração com uma causa subjacente opcional.
   *
   * @param message - Mensagem de erro legível por humanos.
   * @param cause - Erro subjacente ou motivo da configuração inválida.
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_CONFIG: RouterConfig = {
  mode: 'normal',
  tiers: {
    fast: {
      model: 'github-copilot/claude-haiku-4.5',
      costRatio: DEFAULT_FAST_COST_RATIO,
      cap: DEFAULT_TIER_CAP,
      thresholds: { min: 0, max: FAST_TIER_MAX_TOKENS }, // ✅ ERRO-003: Default thresholds
    },
    medium: {
      model: 'github-copilot/gpt-5.3-codex',
      costRatio: DEFAULT_MEDIUM_COST_RATIO,
      cap: DEFAULT_MEDIUM_TIER_CAP,
      thresholds: { min: FAST_TIER_MAX_TOKENS, max: MEDIUM_TIER_MAX_TOKENS },
    },
    heavy: {
      model: 'github-copilot/claude-sonnet-4.5',
      costRatio: DEFAULT_HEAVY_COST_RATIO,
      cap: DEFAULT_HEAVY_TIER_CAP,
      thresholds: { min: HEAVY_TIER_MIN_TOKENS, max: null }, // unlimited
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
    trivialDirectAllowed: false, // ✅ CRITICAL: Always delegate, never allow direct execution
  },
  routing: {
    strategy: 'keyword',
    selectorModel: 'github-copilot/claude-haiku-4.5',
    selectorTimeoutMs: 1200,
    selectorMaxTokens: 16,
  },
  tokenTracking: {
    enabled: true,
    maxHistoryFiles: MAX_HISTORY_FILES, // ✅ ERRO-005: Bounded disk (50 files max)
    maxHistoryDays: MAX_HISTORY_DAYS,
    sessionTTLMinutes: SESSION_TTL_MINUTES, // ✅ ERRO-004: 30-min TTL
    maxSessionsMemory: LRU_MAX_SESSIONS, // ✅ ERRO-004: Max 100 sessions in memory
  },
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve o caminho de tiers.json usando override local do projeto e fallback global.
 *
 * Se ambos os arquivos existem, o arquivo local do projeto prevalece. Se
 * nenhum existir, a função retorna o caminho local do projeto para que os chamadores
 * possam criá-lo lá.
 *
 * @param projectDir - Diretório contendo o projeto OpenCode.
 * @param globalDir - Diretório contendo a config global OpenCode.
 * @returns O caminho resolvido de tiers.json.
 * @example
 * ```ts
 * const path = await resolveTiersPath(process.cwd(), join(homedir(), '.config', 'opencode'));
 * ```
 */
export async function resolveTiersPath(projectDir: string, globalDir: string): Promise<string> {
  const projectPath = join(projectDir, 'tiers.json');
  if (await pathExists(projectPath)) return projectPath;

  const globalPath = join(globalDir, 'tiers.json');
  if (await pathExists(globalPath)) return globalPath;

  return projectPath;
}

/**
 * Carrega e valida tiers.json a partir do caminho de config resolvido.
 *
 * A função lê primeiro a config local do projeto, faz fallback para a config
 * global e lança ConfigError quando o arquivo não pode ser lido ou está malformatado.
 *
 * @param projectDir - Diretório contendo o projeto OpenCode.
 * @param globalDir - Diretório contendo a config global OpenCode.
 * @returns Configuração de roteamento validada.
 * @throws {ConfigError} Quando a config não pode ser lida, analisada ou validada.
 * @example
 * ```ts
 * const cfg = await loadTiers(process.cwd(), join(homedir(), '.config', 'opencode'));
 * ```
 */
export async function loadTiers(projectDir: string, globalDir: string): Promise<RouterConfig> {
  const path = await resolveTiersPath(projectDir, globalDir);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Failed to read tiers config at ${path}`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Malformed JSON in tiers config at ${path}`, err);
  }

  validateConfig(parsed);
  return parsed as RouterConfig;
}

/**
 * Valida e normaliza um objeto bruto de tiers.json.
 *
 * A função aceita config parcial e preenche padrões para as seções enforcement
 * e routing quando ausentes, mas lança erro para campos obrigatórios malformatados.
 * É intencionalmente permissiva quanto a propriedades top-level desconhecidas.
 *
 * @param config - Objeto JSON analisado bruto para validar.
 * @throws {ConfigError} Quando a config é inválida ou incompleta.
 * @returns Nada; se a validação tiver sucesso, `config` é refinado para RouterConfig.
 * @example
 * ```ts
 * validateConfig({ mode: 'normal', tiers: {}, modes: {} });
 * ```
 */
export function validateConfig(config: unknown): asserts config is RouterConfig {
  if (config === null || typeof config !== 'object') {
    throw new ConfigError('tiers.json must be a JSON object');
  }

  const cfg = config as Partial<RouterConfig>;

  if (!cfg.enforcement || typeof cfg.enforcement !== 'object') {
    cfg.enforcement = structuredClone(DEFAULT_CONFIG.enforcement);
  }

  const enforcement = cfg.enforcement as Partial<EnforcementConfig>;
  if (enforcement.mode !== 'advisory' && enforcement.mode !== 'hard-block') {
    throw new ConfigError('enforcement.mode must be "advisory" or "hard-block"');
  }
  if (typeof enforcement.trivialDirectAllowed !== 'boolean') {
    throw new ConfigError('enforcement.trivialDirectAllowed must be boolean');
  }

  if (!cfg.routing || typeof cfg.routing !== 'object') {
    cfg.routing = structuredClone(DEFAULT_CONFIG.routing);
  }

  const routing = cfg.routing as Partial<RoutingConfig>;
  if (routing.strategy !== 'keyword' && routing.strategy !== 'llm') {
    throw new ConfigError('routing.strategy must be "keyword" or "llm"');
  }
  if (typeof routing.selectorModel !== 'string' || routing.selectorModel.length === 0) {
    throw new ConfigError('routing.selectorModel must be a non-empty string');
  }
  if (
    typeof routing.selectorTimeoutMs !== 'number' ||
    !Number.isFinite(routing.selectorTimeoutMs) ||
    routing.selectorTimeoutMs <= 0
  ) {
    throw new ConfigError('routing.selectorTimeoutMs must be a positive number');
  }
  if (
    typeof routing.selectorMaxTokens !== 'number' ||
    !Number.isFinite(routing.selectorMaxTokens) ||
    routing.selectorMaxTokens <= 0
  ) {
    throw new ConfigError('routing.selectorMaxTokens must be a positive number');
  }

  if (typeof cfg.mode !== 'string' || cfg.mode.length === 0) {
    throw new ConfigError('mode must be a non-empty string');
  }

  if (!cfg.modes || typeof cfg.modes !== 'object') {
    throw new ConfigError('modes must be an object');
  }

  if (!cfg.modes[cfg.mode]) {
    throw new ConfigError(`active mode "${cfg.mode}" is not defined in modes`);
  }

  if (!cfg.tiers || typeof cfg.tiers !== 'object') {
    throw new ConfigError('tiers must be an object');
  }

  for (const [modeName, mode] of Object.entries(cfg.modes)) {
    if (!mode || typeof mode !== 'object') {
      throw new ConfigError(`mode "${modeName}" must be an object`);
    }
    const defaultTier = (mode as Partial<ModeConfig>).defaultTier;
    if (typeof defaultTier !== 'string' || defaultTier.length === 0) {
      throw new ConfigError(`mode "${modeName}" is missing defaultTier`);
    }
    if (!cfg.tiers[defaultTier]) {
      throw new ConfigError(`mode "${modeName}" defaultTier "${defaultTier}" does not exist in tiers`);
    }
  }

  for (const [tierName, tier] of Object.entries(cfg.tiers)) {
    if (!tier || typeof tier !== 'object') {
      throw new ConfigError(`tier "${tierName}" must be an object`);
    }
    const t = tier as Partial<TierConfig>;
    if (typeof t.model !== 'string' || t.model.length === 0) {
      throw new ConfigError(`tier "${tierName}" is missing a model`);
    }
    if (typeof t.costRatio !== 'number' || !Number.isFinite(t.costRatio) || t.costRatio <= 0) {
      throw new ConfigError(`tier "${tierName}" costRatio must be a positive number`);
    }
    if (typeof t.cap !== 'number' || !Number.isFinite(t.cap) || t.cap <= 0) {
      throw new ConfigError(`tier "${tierName}" cap must be a positive number`);
    }
    // ✅ ERRO-003: Validate thresholds if present
    if (t.thresholds) {
      if (typeof t.thresholds !== 'object') {
        throw new ConfigError(`tier "${tierName}" thresholds must be an object`);
      }
      const th = t.thresholds as Partial<TokenThresholds>;
      if (typeof th.min !== 'number' || !Number.isFinite(th.min) || th.min < 0) {
        throw new ConfigError(`tier "${tierName}" thresholds.min must be a non-negative number`);
      }
      if (th.max !== null && (typeof th.max !== 'number' || !Number.isFinite(th.max) || th.max < th.min!)) {
        throw new ConfigError(`tier "${tierName}" thresholds.max must be null or a number >= min`);
      }
    }
  }

  if (!cfg.taskPatterns || typeof cfg.taskPatterns !== 'object') {
    throw new ConfigError('taskPatterns must be an object');
  }

  for (const tierName of Object.keys(cfg.tiers)) {
    const patterns = (cfg.taskPatterns as unknown as Record<string, unknown>)[tierName];
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new ConfigError(`taskPatterns for tier "${tierName}" must be a non-empty array`);
    }
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new ConfigError(`taskPatterns for tier "${tierName}" must contain non-empty strings`);
      }
    }
  }

  // ✅ ERRO-003, ERRO-004, ERRO-005: Validate tokenTracking if present
  if (cfg.tokenTracking) {
    if (typeof cfg.tokenTracking !== 'object') {
      throw new ConfigError('tokenTracking must be an object');
    }
    const tt = cfg.tokenTracking as Partial<TokenTrackingConfig>;
    if (tt.enabled !== undefined && typeof tt.enabled !== 'boolean') {
      throw new ConfigError('tokenTracking.enabled must be boolean');
    }
    if (
      tt.maxHistoryFiles !== undefined &&
      (typeof tt.maxHistoryFiles !== 'number' || !Number.isFinite(tt.maxHistoryFiles) || tt.maxHistoryFiles < 1)
    ) {
      throw new ConfigError('tokenTracking.maxHistoryFiles must be a positive number');
    }
    if (
      tt.maxHistoryDays !== undefined &&
      (typeof tt.maxHistoryDays !== 'number' || !Number.isFinite(tt.maxHistoryDays) || tt.maxHistoryDays < 1)
    ) {
      throw new ConfigError('tokenTracking.maxHistoryDays must be a positive number');
    }
    if (
      tt.sessionTTLMinutes !== undefined &&
      (typeof tt.sessionTTLMinutes !== 'number' || !Number.isFinite(tt.sessionTTLMinutes) || tt.sessionTTLMinutes < 1)
    ) {
      throw new ConfigError('tokenTracking.sessionTTLMinutes must be a positive number');
    }
    if (
      tt.maxSessionsMemory !== undefined &&
      (typeof tt.maxSessionsMemory !== 'number' || !Number.isFinite(tt.maxSessionsMemory) || tt.maxSessionsMemory < 1)
    ) {
      throw new ConfigError('tokenTracking.maxSessionsMemory must be a positive number');
    }
  }
}

/**
 * Salva o modo de roteamento ativo em tiers.json local do projeto.
 *
 * A função cria o diretório do projeto se necessário, lê a config do projeto
 * existente quando presente, atualiza `mode` e grava um arquivo temporário antes
 * de renomeá-lo para o destino.
 *
 * @param mode - Nome do modo a ativar.
 * @param projectDir - Diretório onde tiers.json deve ser gravado.
 * @returns Configuração de roteamento atualizada.
 * @throws {ConfigError} Quando o modo é desconhecido, a config existente está malformatada ou a gravação falha.
 * @example
 * ```ts
 * const cfg = await saveMode('budget', process.cwd());
 * ```
 */
export async function saveMode(mode: string, projectDir: string): Promise<RouterConfig> {
  if (typeof mode !== 'string' || mode.length === 0) {
    throw new ConfigError('mode must be a non-empty string');
  }

  if (!DEFAULT_CONFIG.modes[mode]) {
    throw new ConfigError(`unknown mode "${mode}"`);
  }

  const projectPath = join(projectDir, 'tiers.json');
  let cfg: RouterConfig;

  if (await pathExists(projectPath)) {
    const raw = await readFile(projectPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Cannot update tiers.json: existing file is malformed`, err);
    }
    validateConfig(parsed);
    cfg = parsed as RouterConfig;
  } else {
    cfg = structuredClone(DEFAULT_CONFIG);
  }

  cfg.mode = mode;

  await mkdir(projectDir, { recursive: true });

  const tmpPath = join(projectDir, 'tiers.json.tmp');
  try {
    await writeFile(tmpPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    await rename(tmpPath, projectPath);
  } catch (err) {
    throw new ConfigError(`Failed to write tiers.json at ${projectPath}`, err);
  }

  return cfg;
}

/**
 * Retorna o tier padrão do modo ativo e o mapa de tiers configurado.
 *
 * @param cfg - Configuração de roteamento a inspecionar.
 * @returns Resumo de tiers ativos para o modo configurado.
 * @throws {ConfigError} Quando o modo ativo é desconhecido.
 * @example
 * ```ts
 * const active = getActiveTiers(config);
 * ```
 */
export function getActiveTiers(cfg: RouterConfig): ActiveTiers {
  const mode = cfg.modes[cfg.mode];
  if (!mode) {
    throw new ConfigError(`unknown mode "${cfg.mode}"`);
  }
  return { defaultTier: mode.defaultTier, tiers: cfg.tiers };
}
