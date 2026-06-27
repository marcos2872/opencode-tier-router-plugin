import type { TaskPatterns } from './config.js';

const regexCache = new Map<string, RegExp>();

/**
 * Classifica um texto de tarefa no primeiro tier OpenCode correspondente.
 *
 * O classificador verifica padrões heavy, medium e depois fast nessa ordem
 * para que palavras-chave mais complexas tenham precedência. Ele combina prefixos de padrões em
 * limites de palavra e retorna `null` quando nenhum padrão de tier corresponde.
 *
 * @param text - Texto da tarefa do usuário a classificar.
 * @param patterns - Mapa de padrões de tier para palavra-chave da config do router.
 * @returns O tier correspondente, ou `null` quando nenhum padrão corresponde.
 * @example
 * ```ts
 * const tier = classifyTask('fix the build script', { fast: [], medium: ['build', 'fix'], heavy: [] });
 * ```
 */
export function classifyTask(
  text: string,
  patterns: TaskPatterns,
): 'fast' | 'medium' | 'heavy' | null {
  const lower = text.toLowerCase();
  const order: Array<'heavy' | 'medium' | 'fast'> = ['heavy', 'medium', 'fast'];

  for (const tier of order) {
    const tierPatterns = patterns[tier];
    if (!tierPatterns) continue;
    for (const pattern of tierPatterns) {
      if (matchesWordStart(lower, pattern)) {
        return tier;
      }
    }
  }

  return null;
}

/**
 * Corresponde uma palavra-chave normalizada no início de uma palavra.
 *
 * Os padrões são escapados antes de criar a expressão regular para que caracteres especiais
 * sejam tratados literalmente e não se tornem sintaxe regex.
 *
 * @param text - Texto de tarefa em minúsculas a pesquisar.
 * @param pattern - Padrão de palavra-chave a corresponder.
 * @returns `true` quando o padrão aparece em um limite de palavra.
 */
function matchesWordStart(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cacheKey = `\\b${escaped}`;
  let regex = regexCache.get(cacheKey);
  if (!regex) {
    regex = new RegExp(cacheKey, 'i');
    regexCache.set(cacheKey, regex);
  }
  return regex.test(text);
}
