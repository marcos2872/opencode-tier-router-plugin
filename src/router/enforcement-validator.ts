/**
 * Validador de aplicação — Garantir 100% de delegação
 *
 * Valida que o plugin SEMPRE delega tarefas para subagentes.
 * Nunca permite execução direta na janela principal.
 *
 * Princípios:
 * 1. A janela principal é SOMENTE um orquestrador
 * 2. Todo trabalho é delegado aos subagentes @fast/@medium/@heavy
 * 3. Sem exceções para tarefas "triviais"
 * 4. enforcement.mode = "hard-block" (não advisory)
 * 5. enforcement.trivialDirectAllowed = false (sem bypass)
 */

import type { RouterConfig } from './config.js';

/**
 * Resultado da validação das regras de aplicação obrigatória de delegação.
 *
 * @property isValid - Indica se nenhuma regra crítica de enforcement foi violada.
 * @property errors - Lista de erros que impedem a aplicação segura de 100% de delegação.
 * @property warnings - Lista de avisos não bloqueantes sobre cobertura ou qualidade da configuração.
 * @property recommendations - Lista de recomendações para melhorar auditoria, custos ou aderência.
 */
export interface EnforcementValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Valida configuração de aplicação para 100% de delegação
 *
 * Regras:
 * - enforcement.mode DEVE ser "hard-block" (não "advisory")
 * - enforcement.trivialDirectAllowed DEVE ser false (sem bypass)
 * - Os 3 tiers (fast, medium, heavy) devem estar configurados com modelos válidos
 * - Config precisa ter estratégia de roteamento adequada
 */
export function validateEnforcement(cfg: RouterConfig): EnforcementValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // ✅ CRITICAL: enforcement.mode MUST be hard-block
  if (cfg.enforcement.mode !== 'hard-block') {
    errors.push(
      `❌ CRITICAL: enforcement.mode is "${cfg.enforcement.mode}" but MUST be "hard-block". ` +
      `Advisory mode allows tasks to bypass delegation!`,
    );
  }

  // ✅ CRITICAL: trivialDirectAllowed MUST be false
  if (cfg.enforcement.trivialDirectAllowed === true) {
    errors.push(
      `❌ CRITICAL: enforcement.trivialDirectAllowed is true but MUST be false. ` +
      `This allows "trivial" tasks to execute directly in main window!`,
    );
  }

  // ✅ All tiers must exist and have valid models
  const requiredTiers = ['fast', 'medium', 'heavy'] as const;
  for (const tier of requiredTiers) {
    if (!cfg.tiers[tier]) {
      errors.push(`❌ Missing tier: @${tier} is required`);
      continue;
    }

    const tierCfg = cfg.tiers[tier];
    if (!tierCfg.model || !/^[^/]+\/[^/]+$/.test(tierCfg.model)) {
      errors.push(
        `❌ Invalid model for @${tier}: "${tierCfg.model}" doesn't match "provider/model" format`,
      );
    }

    if (typeof tierCfg.costRatio !== 'number' || tierCfg.costRatio <= 0) {
      errors.push(`❌ Invalid costRatio for @${tier}: must be positive number`);
    }

    if (typeof tierCfg.cap !== 'number' || tierCfg.cap <= 0) {
      errors.push(`❌ Invalid cap for @${tier}: must be positive number`);
    }
  }

  // ✅ Routing strategy must be keyword or llm
  if (cfg.routing.strategy !== 'keyword' && cfg.routing.strategy !== 'llm') {
    errors.push(
      `❌ Invalid routing.strategy: "${cfg.routing.strategy}" (must be "keyword" or "llm")`,
    );
  }

  // ✅ Task patterns should have reasonable coverage
  const fastPatterns = cfg.taskPatterns.fast ?? [];
  const mediumPatterns = cfg.taskPatterns.medium ?? [];
  const heavyPatterns = cfg.taskPatterns.heavy ?? [];

  if (fastPatterns.length < 3) {
    warnings.push(
      `⚠️  Too few fast patterns (${fastPatterns.length}): may not catch search tasks`,
    );
  }

  if (mediumPatterns.length < 5) {
    warnings.push(
      `⚠️  Too few medium patterns (${mediumPatterns.length}): may not catch implementation tasks`,
    );
  }

  if (heavyPatterns.length < 5) {
    warnings.push(
      `⚠️  Too few heavy patterns (${heavyPatterns.length}): may not catch architecture/design tasks`,
    );
  }

  // ✅ Cost ratio should have reasonable hierarchy (fast < medium < heavy)
  const fastCost = cfg.tiers.fast?.costRatio ?? 0;
  const mediumCost = cfg.tiers.medium?.costRatio ?? 0;
  const heavyCost = cfg.tiers.heavy?.costRatio ?? 0;

  if (fastCost >= mediumCost) {
    errors.push(
      `❌ Cost hierarchy violated: @fast (${fastCost}x) should be < @medium (${mediumCost}x)`,
    );
  }

  if (mediumCost >= heavyCost) {
    errors.push(
      `❌ Cost hierarchy violated: @medium (${mediumCost}x) should be < @heavy (${heavyCost}x)`,
    );
  }

  // ⚠️ Token tracking should be enabled for compliance
  if (!cfg.tokenTracking?.enabled) {
    recommendations.push(
      `💡 Enable tokenTracking for full cost tracking and compliance auditing`,
    );
  }

  const isValid = errors.length === 0;
  return { isValid, errors, warnings, recommendations };
}

/**
 * Asserta que configuração de aplicação é válida para 100% de delegação
 * Lança erro se validação falhar
 */
export function assertEnforcement(cfg: RouterConfig): void {
  const validation = validateEnforcement(cfg);

  if (!validation.isValid) {
    const errorMsg = validation.errors
      .map((e) => `  ${e}`)
      .join('\n');
    throw new Error(
      `[Enforcement] Configuration invalid for 100% delegation:\n${errorMsg}`,
    );
  }

  if (validation.warnings.length > 0) {
    console.warn(
      '[Enforcement] Warnings:\n' +
      validation.warnings.map((w) => `  ${w}`).join('\n'),
    );
  }
}

/**
 * Gera relatório de aplicação para depuração
 */
export function reportEnforcement(cfg: RouterConfig): string {
  const validation = validateEnforcement(cfg);

  const lines = [
    '═══════════════════════════════════════════════════════════════',
    'ENFORCEMENT VALIDATION REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Status: ${validation.isValid ? '✅ VALID' : '❌ INVALID'}`,
    '',
    '--- Configuration ---',
    `enforcement.mode: ${cfg.enforcement.mode}`,
    `enforcement.trivialDirectAllowed: ${cfg.enforcement.trivialDirectAllowed}`,
    `routing.strategy: ${cfg.routing.strategy}`,
    `mode: ${cfg.mode}`,
    '',
    '--- Tier Models ---',
    `@fast:   ${cfg.tiers.fast?.model ?? 'n/a'} (${cfg.tiers.fast?.costRatio ?? 'n/a'}x)`,
    `@medium: ${cfg.tiers.medium?.model ?? 'n/a'} (${cfg.tiers.medium?.costRatio ?? 'n/a'}x)`,
    `@heavy:  ${cfg.tiers.heavy?.model ?? 'n/a'} (${cfg.tiers.heavy?.costRatio ?? 'n/a'}x)`,
    '',
  ];

  if (validation.errors.length > 0) {
    lines.push('--- ERRORS (Must Fix) ---');
    validation.errors.forEach((e) => lines.push(e));
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('--- WARNINGS (Recommended) ---');
    validation.warnings.forEach((w) => lines.push(w));
    lines.push('');
  }

  if (validation.recommendations.length > 0) {
    lines.push('--- RECOMMENDATIONS ---');
    validation.recommendations.forEach((r) => lines.push(r));
    lines.push('');
  }

  if (validation.isValid) {
    lines.push(
      '✅ All checks passed! Plugin enforces 100% delegation to subagents.',
    );
  }

  lines.push(
    '═══════════════════════════════════════════════════════════════',
  );

  return lines.join('\n');
}
