/**
 * Parse JSON string with size validation.
 * Prevents DoS attacks via oversized JSON payloads.
 *
 * @param json - JSON string to parse
 * @param maxSize - Maximum allowed size in bytes (default: 1MB)
 * @returns Parsed value or null on failure
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
