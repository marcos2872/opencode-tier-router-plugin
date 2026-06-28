/**
 * Prompt builders — Centraliza todos os prompts e templates de string
 * enviados a LLMs ou injetados no system prompt do modelo base.
 *
 * Cada export é uma função pura ou constante nomeada, com parâmetros
 * tipados para os valores dinâmicos. Nenhuma função aqui tem efeito
 * colateral ou acesso a estado.
 */

import type { RouterConfig } from './router/config.js';

/**
 * Prompt de classificação para o seletor LLM.
 *
 * Enviado via `api.session.prompt()` quando `routing.strategy === 'llm'`.
 * Pede ao modelo que classifique a solicitação do usuário em fast/medium/heavy.
 *
 * @param text - Texto da solicitação do usuário a ser classificado.
 * @returns Prompt de uma linha por vez, com instrução de saída de uma palavra.
 */
export function buildSelectorPrompt(text: string): string {
  return [
    'Classify the user request into one tier: fast, medium, or heavy.',
    'Return exactly one word: fast OR medium OR heavy.',
    'fast = search/read/list/explore',
    'medium = implement/refactor/fix/change/create',
    'heavy = architecture/debug/analyze/quality/review',
    `request: ${text}`,
  ].join('\n');
}

/**
 * Mapa de ênfase textual por modo de roteamento.
 *
 * Descreve de forma legível a estratégia do modo atual para o modelo base.
 */
export const MODE_EMPHASIS: Record<string, string> = {
  normal: 'balanced — use cheapest matching tier, fallback to default',
  budget: 'cost-first — prefer @fast unless heavy keywords dominate',
  quality: 'quality-first — prefer @medium/@heavy over @fast',
  deep: 'depth-first — route architecture/debug to @heavy, default @heavy',
};

/**
 * Protocolo completo de delegação de tarefas.
 *
 * Injetado no system prompt do modelo base via `chat.system.transform`.
 * Descreve tiers disponíveis, regras de roteamento, custos e política de
 * enforcement. É o principal mecanismo de instrução do modelo sobre como
 * e quando delegar para subagentes.
 *
 * @param cfg - Configuração completa do roteador.
 * @returns Bloco Markdown com o protocolo de delegação (~210 tokens).
 */
export function buildDelegationProtocol(cfg: RouterConfig): string {
  const activeMode = cfg.modes[cfg.mode];
  const defaultTier = activeMode?.defaultTier ?? 'medium';

  const tiersLine = Object.entries(cfg.tiers)
    .map(([name, tier]) => `@${name}=${tier.model}(${tier.costRatio}x)`)
    .join(' ');

  const rulesLine = Object.entries(cfg.taskPatterns)
    .map(([tier, patterns]) => `@${tier}→${patterns.join('/')}`)
    .join(' ');

  const emphasis = MODE_EMPHASIS[cfg.mode] ?? `mode ${cfg.mode}, default @${defaultTier}`;

  return [
    '--- Task Delegation Reference ---',
    ``,
    `Tiers: ${tiersLine} mode:${cfg.mode}`,
    `Default: @${defaultTier}`,
    `Routing: strategy=${cfg.routing.strategy} selector=${cfg.routing.selectorModel}`,
    `R: ${rulesLine}`,
    `Mode: ${cfg.mode} (${emphasis})`,
    `Cost signal: @fast≈1x, @medium≈5x, @heavy≈20x.`,
    ``,
    '--- Recommended Delegation ---',
    `Rule: Respect cap/redundancy banners from subagents; they signal read-limit fatigue.`,
    `Rule: When a task matches a tier's patterns, delegate to the cheapest matching tier via "task".`,
    `Rule: Subagents have isolated context and full tool access. They execute the work and return results. Subagents cannot delegate to other subagents — only the main session can delegate.`,
    '---',
  ].join('\n');
}

/**
 * Dica de roteamento para a sessão atual.
 *
 * Injetada no system prompt após o protocolo de delegação. Informa ao
 * modelo qual tier foi pré-selecionado para esta solicitação específica
 * e por qual fonte (llm, keyword, fallback).
 *
 * @param tier - Nome do tier pré-selecionado (fast, medium, heavy).
 * @param source - Origem da seleção (llm, keyword, fallback-keyword, fallback-default).
 * @returns Frase de dica de roteamento.
 */
export function buildRoutingHint(tier: string, source?: string): string {
  const src = source ? ` (source: ${source})` : '';
  return `Routing hint: Preferred tier for this request is @${tier}${src}. DELEGATE to @${tier}. Direct execution is BLOCKED — the only way to complete this request is delegation.`;
}

/**
 * Mensagem de HARD-BLOCK para a sessão atual.
 *
 * Injetada no system prompt quando o enforcement mode é hard-block.
 * Instrui o modelo a NÃO executar ferramentas diretamente e a delegar
 * imediatamente para o tier especificado.
 *
 * @param tier - Nome do tier para o qual a solicitação deve ser delegada.
 * @param reason - Razão opcional adicional para o bloqueio.
 * @returns Frase de HARD-BLOCK.
 */
export function buildHardBlockMessage(tier: string, reason?: string): string {
  const suffix = reason ? ` ${reason}` : '';
  return [
    `❗ HARD-BLOCK ACTIVE — YOU ARE A ROUTER, NOT AN EXECUTOR`,
    ``,
    `This request is classified as @${tier} tier and MUST be delegated.`,
    ``,
    `ALL TOOLS EXCEPT "task" ARE DENIED:`,
    `  grep    → DENIED — delegate search to @fast via "task"`,
    `  glob    → DENIED — delegate search to @fast via "task"`,
    `  read    → DENIED — delegate read to @fast via "task"`,
    `  list    → DENIED — delegate listing to @fast via "task"`,
    `  bash    → DENIED — delegate execution to @medium/@heavy via "task"`,
    `  edit    → DENIED — delegate edits to @medium via "task"`,
    `  write   → DENIED — delegate writes to @medium via "task"`,
    `  webfetch→ DENIED — delegate fetch to @medium via "task"`,
    `  websearch→ DENIED — delegate search to @medium via "task"`,
    ``,
    `REQUIRED ACTION:`,
    `  1. Call "task" with subagent_type="${tier}" and a description of the work`,
    `  2. The subagent has full tool access and will execute the request`,
    `  3. WAIT for the subagent result — do NOT try to execute tools yourself`,
    ``,
    `If you attempt to call any tool other than "task", it will be REJECTED and you will get a "Permission denied" error. Repeated denials waste context and harm session quality.${suffix}`,
  ].join('\n');
}

/**
 * Anotação de narração detectada.
 *
 * Anexada à saída do modelo quando o detector de narração identifica
 * um padrão de pensamento em voz alta (chain-of-thought não solicitado).
 *
 * @param match - Texto da narração detectada.
 * @returns Anotação para appended à saída do modelo.
 */
export function buildNarrationAnnotation(match: string): string {
  return `\n\n[⚠ narration detected: "${match}"]`;
}
