/**
 * Analisa uma string JSON com validação de tamanho.
 * Previne ataques DoS por meio de cargas JSON acima do tamanho permitido.
 *
 * @param json - Texto JSON a ser analisado
 * @param maxSize - Tamanho máximo permitido em bytes (padrão: 1MB)
 * @returns Valor parseado ou `null` em caso de falha
 */
export function safeJsonParse<T>(json: string, maxSize: number = 1024 * 1024): T | null {
  if (json.length > maxSize) {
    console.warn(`[safeJsonParse] JSON exceeds size limit (${json.length} > ${maxSize})`);
    return null;
  }

  try {
    return JSON.parse(json) as T;
  } catch {
    console.warn('[safeJsonParse] Failed to parse JSON');
    return null;
  }
}
