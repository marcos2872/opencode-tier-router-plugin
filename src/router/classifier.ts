import type { TaskPatterns } from './config.js';

const regexCache = new Map<string, RegExp>();

/**
 * Classify a task text into the first matching OpenCode tier.
 *
 * The classifier checks heavy, medium, and then fast patterns in that order
 * so more complex keywords take precedence. It matches pattern prefixes at
 * word boundaries and returns `null` when no tier pattern matches.
 *
 * @param text - User task text to classify.
 * @param patterns - Tier-to-keyword pattern map from router config.
 * @returns The matched tier, or `null` when no pattern matches.
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
 * Match a normalized keyword at the start of a word.
 *
 * Patterns are escaped before creating the regular expression so special
 * characters are treated literally and cannot become regex syntax.
 *
 * @param text - Lowercase task text to search.
 * @param pattern - Keyword pattern to match.
 * @returns `true` when the pattern appears at a word boundary.
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
