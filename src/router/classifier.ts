import type { TaskPatterns } from './config.js';

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

function matchesWordStart(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}`, 'i');
  return regex.test(text);
}
