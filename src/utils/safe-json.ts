export function safeJsonParse<T>(json: string, maxSize: number = 1024 * 1024): T | null {
  if (typeof json !== 'string' || json.length === 0) return null;
  if (json.length > maxSize) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
