const NOUN_PHRASE = String.raw`[\w'-]+(?:\s+[\w'-]+){0,5}`;

/**
 * Padrões de expressão narrativa usados para detectar intenção de criar, implementar ou adicionar algo.
 *
 * @remarks
 * Esses padrões são avaliados em ordem por `detectNarration`; o primeiro `match` encontrado retorna a correspondência.
 */
export const NARRATION_PATTERNS: RegExp[] = [
  // Still writing/implementing/working on the X
  new RegExp(String.raw`\bstill\s+(?:writing|implementing|working\s+on)\s+(?:the\s+)?${NOUN_PHRASE}`, 'i'),
  // Now I'll write/implement/add the X
  new RegExp(String.raw`\bnow\s+i['’]ll\s+(?:write|implement|add)\s+(?:the\s+)?${NOUN_PHRASE}`, 'i'),
  // Let me write/implement/add the X
  new RegExp(String.raw`\blet\s+me\s+(?:write|implement|add)\s+(?:the\s+)?${NOUN_PHRASE}`, 'i'),
  // I'll now write/implement the X
  new RegExp(String.raw`\bi['’]ll\s+now\s+(?:write|implement)\s+(?:the\s+)?${NOUN_PHRASE}`, 'i'),
  // Going to write/implement the X
  new RegExp(String.raw`\bgoing\s+to\s+(?:write|implement)\s+(?:the\s+)?${NOUN_PHRASE}`, 'i'),
];

/**
 * Detecta se `text` corresponde a uma expressão narrativa conhecida.
 *
 * @param text - Texto a ser analisado.
 * @returns A correspondência encontrada, preservando a posição original da string, ou `null` quando nenhum padrão combinar.
 */
export function detectNarration(text: string): string | null {
  for (const pattern of NARRATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}
